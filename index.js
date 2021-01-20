const editorNode = document.getElementById("___editor");
window.editor = editorNode;

function isTextNode(node) {
  return node.nodeType === Node.TEXT_NODE;
}

function findLocationFromContainerAndOffset(container, containerOffset) {
  let offset = 0;
  let childIndex = 0;
  let walker = document.createTreeWalker(
    editorNode,
    NodeFilter.SHOW_ALL,
    {
      acceptNode: function (node) {
        return NodeFilter.FILTER_ACCEPT;
      },
    },
    false
  );

  while (walker.nextNode()) {
    let node = walker.currentNode;

    if (node === container) {
      if (isTextNode(node) || node.nodeName === "SPAN") {
        return offset + containerOffset;
      }

      return offset;
    } else {
      if (isTextNode(node)) {
        offset += node.textContent.length;
      } else if (node.nodeName === "BR") {
        offset += 1;
      }

      if (node.parentNode === container) {
        childIndex += 1;
        if (childIndex === containerOffset) {
          return offset;
        }
      }
    }
  }
}

function serialize(dom) {
  function bb(dom) {
    let texts;

    if (dom.nodeType === Node.TEXT_NODE) {
      return { type: "text", content: dom.data, attrs: {} };
    } else {
      switch (dom.nodeName) {
        case "SPAN":
          let attrs = {};
          for (let className of dom.classList) {
            switch (className) {
              case "bold-text": {
                attrs.bold = true;
                break;
              }
              case "italic-text": {
                attrs.italic = true;
                break;
              }
              case "header1-text": {
                attrs.header = 1;
                break;
              }
              case "header2-text": {
                attrs.header = 2;
                break;
              }
            }
          }

          texts = [];
          for (let child of dom.childNodes) {
            texts = texts.concat(bb(child));
          }

          for (let text of texts) {
            text.attrs = { ...text.attrs, ...attrs };
          }

          return texts;
        case "BR":
          return { type: "text", content: "\n", attrs: {} };
        default:
      }
    }
  }

  let t = [];
  for (let child of dom.childNodes) {
    t = t.concat(bb(child));
  }

  return t;
}

class Text {
  static splitAtOffset(text, offset) {
    if (offset === 0) {
      return [null, text];
    } else if (offset === text.content.length) {
      return [text, null];
    } else {
      let left = {
        ...text,
        attrs: { ...text.attrs },
        content: text.content.slice(0, offset),
      };
      let right = {
        ...text,
        attrs: { ...text.attrs },
        content: text.content.slice(offset),
      };
      return [left, right];
    }
  }

  static canTextsBeConsolidated(text1, text2) {
    let attrs1 = Object.keys(text1.attrs);
    let attrs2 = Object.keys(text2.attrs);

    if (attrs1.length !== attrs2.length) {
      return false;
    }

    for (let attr of attrs1) {
      if (text1.attrs[attr] !== text2.attrs[attr]) {
        return false;
      }
    }

    return true;
  }

  static consolidateTexts(text1, text2) {
    return {
      ...text1,
      content: text1.content + text2.content,
    };
  }
}

class TextList {
  static findIndexAndOffsetAtPosition(textList, position) {
    let currentPosition = 0;
    for (let [index, text] of textList.entries()) {
      let nextPosition = currentPosition + text.content.length;
      if (position >= currentPosition && position < nextPosition) {
        return {
          index,
          offset: position - currentPosition,
        };
      }
      currentPosition = nextPosition;
    }

    return { index: null, offset: null };
  }

  static splitAtPosition(textList, position) {
    let { index, offset } = TextList.findIndexAndOffsetAtPosition(
      textList,
      position
    );
    let tl = [...textList];
    let splitIndex, splitOffset;

    if (index !== null) {
      if (offset === 0) {
        splitIndex = index;
        splitOffset = 0;
      } else {
        let text = tl[index];
        let [leftObject, rightObject] = Text.splitAtOffset(text, offset);
        tl.splice(index, 1, leftObject, rightObject);
        splitIndex = index + 1;
        splitOffset = leftObject.content.length - offset;
      }
    } else {
      splitIndex = tl.length;
      splitOffset = 0;
    }

    return {
      textList: tl,
      splitIndex,
      splitOffset,
    };
  }

  static splitAtRange(textList, startPosition, endPosition) {
    let {
      textList: yy,
      splitIndex: leftInnerIndex,
      splitOffset,
    } = TextList.splitAtPosition(textList, startPosition);
    let {
      textList: yyy,
      splitIndex: rightOuterIndex,
    } = TextList.splitAtPosition(yy, endPosition + splitOffset);
    return [yyy, leftInnerIndex, rightOuterIndex - 1];
  }

  static consolidate(textList) {
    let tl = [];
    let pending = textList[0];

    for (let text of textList.slice(1)) {
      if (Text.canTextsBeConsolidated(pending, text)) {
        pending = Text.consolidateTexts(pending, text);
      } else {
        tl.push(pending);
        pending = text;
      }
    }

    if (pending) {
      tl.push(pending);
    }

    return TextList.consolidateHeaders(tl);
  }

  static consolidateHeaders(textList) {
    function group(textList, header) {
      for (let text of textList) {
        delete text.attrs.header;
      }

      return { type: "text", attrs: { header }, content: textList };
    }

    let newTextList = [];
    let pending = null;
    let header = null;
    for (let i = 0; i < textList.length; i++) {
      let text = textList[i];
      if (text.attrs.header) {
        if (pending) {
          if (text.attrs.header === header) {
            pending.push(text);
          } else {
            newTextList.push(group(pending, header));
            header = text.attrs.header;
            pending = [text];
          }
        } else {
          header = text.attrs.header;
          pending = [text];
        }
      } else {
        if (pending) {
          newTextList.push(group(pending, header));
          header = null;
          pending = null;
        }
        newTextList.push(text);
      }
    }

    if (pending) {
      newTextList.push(group(pending, header));
    }

    return newTextList;
  }

  static insertTextListAtIndex(textList, textListForInsertion, index) {
    let newTextList = textList.slice(0);
    newTextList.splice(index, 0, ...textListForInsertion);
    return newTextList;
  }
}

function sanitize(string) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
    "/": "&#x2F;",
  };
  const reg = /[&<>"'/]/gi;
  return string.replace(reg, (match) => map[match]);
}

function deserialize(t) {
  function attrToClassName(attrName, attrValue) {
    if (attrName === "bold") {
      return "bold-text";
    } else if (attrName === "italic") {
      return "italic-text";
    } else if (attrName === "header") {
      return `header${attrValue}-text`;
    }

    throw new Error("!!!");
  }

  function textToDom(n) {
    let dom;
    switch (n.type) {
      case "text":
        dom = document.createElement("span");

        for (let attr of Object.keys(n.attrs)) {
          if (n.attrs[attr]) {
            let className = attrToClassName(attr, n.attrs[attr]);
            dom.classList.add(className);
          }
        }

        if (Array.isArray(n.content)) {
          dom.appendChild(deserialize(n.content));
        } else {
          let content = sanitize(n.content).replace(/\n/g, "<br />");
          dom.innerHTML = content;
        }

        return dom;
      default:
        return;
    }
  }

  let dom = new DocumentFragment();
  for (let text of t) {
    dom.appendChild(textToDom(text));
  }

  return dom;
}

function deserializeWord(t) {
  function attrToStyles(attrName, attrValue) {
    if (attrName === "bold") {
      return { "font-weight": 700 };
    } else if (attrName === "italic") {
      return { "font-style": "italic" };
    } else if (attrName === "header") {
      return {
        "font-size": attrValue === 1 ? "20pt" : "17pt",
        "line-height": "20px",
        "font-weight": 500,
      };
    }

    throw new Error("!!!");
  }

  function textToDom(n) {
    let dom;
    switch (n.type) {
      case "text":
        if (Array.isArray(n.content)) {
          dom = document.createElement("div");
        } else {
          dom = document.createElement("span");
        }

        let style = {};
        for (let attr of Object.keys(n.attrs)) {
          if (n.attrs[attr]) {
            style = { ...style, ...attrToStyles(attr, n.attrs[attr]) };
          }
        }
        Object.assign(dom.style, style);

        if (Array.isArray(n.content)) {
          dom.appendChild(deserialize(n.content));
        } else {
          let content = sanitize(n.content).replace(/\n/g, "<br />");
          dom.innerHTML = content;
        }

        return dom;
      default:
        return;
    }
  }

  let dom = new DocumentFragment();
  for (let text of t) {
    dom.appendChild(textToDom(text));
  }

  return dom;
}

editorNode.addEventListener("copy", (event) => {
  event.preventDefault();

  let textList = serialize(editorNode);
  let range = window.getSelection().getRangeAt(0).cloneRange();

  let startPosition = findLocationFromContainerAndOffset(
    range.startContainer,
    range.startOffset
  );
  let endPosition = findLocationFromContainerAndOffset(
    range.endContainer,
    range.endOffset
  );

  let [
    _textList,
    startSelectionIndex,
    endSelectionIndex,
  ] = TextList.splitAtRange(textList, startPosition, endPosition);

  let selected = _textList.slice(startSelectionIndex, endSelectionIndex + 1);
  event.clipboardData.setData("application/json", JSON.stringify(selected));

  let dom = document.createElement("div");
  dom.appendChild(deserializeWord(TextList.consolidate(selected)));
  event.clipboardData.setData("text/html", dom.outerHTML);
});

editorNode.addEventListener("cut", (event) => {
  event.preventDefault();

  let textList = serialize(editorNode);
  let range = window.getSelection().getRangeAt(0).cloneRange();

  let startPosition = findLocationFromContainerAndOffset(
    range.startContainer,
    range.startOffset
  );
  let endPosition = findLocationFromContainerAndOffset(
    range.endContainer,
    range.endOffset
  );

  let [
    _textList,
    startSelectionIndex,
    endSelectionIndex,
  ] = TextList.splitAtRange(textList, startPosition, endPosition);

  let selected = _textList.slice(startSelectionIndex, endSelectionIndex + 1);
  event.clipboardData.setData("application/json", JSON.stringify(selected));

  let dom = document.createElement("div");
  dom.appendChild(deserializeWord(TextList.consolidate(selected)));
  event.clipboardData.setData("text/html", dom.outerHTML);

  _textList.splice(
    startSelectionIndex,
    endSelectionIndex - startSelectionIndex + 1
  );

  editorNode.replaceChildren(deserialize(_textList));

});

editorNode.addEventListener("paste", (event) => {
  event.preventDefault();

  let data = event.clipboardData.getData("application/json");
  if (!data) {
    return;
  }

  let textListForInsertion;
  try {
    textListForInsertion = JSON.parse(data);
  } catch (err) {
    console.error("please don't");
    return;
  }

  let range = window.getSelection().getRangeAt(0).cloneRange();

  let startPosition = findLocationFromContainerAndOffset(
    range.startContainer,
    range.startOffset
  );
  let endPosition = findLocationFromContainerAndOffset(
    range.endContainer,
    range.endOffset
  );

  let textList = serialize(editorNode);

  if (range.collapsed) {
    let insertionIndex;
    ({ textList, splitIndex: insertionIndex } = TextList.splitAtPosition(
      textList,
      startPosition
    ));
    textList = TextList.insertTextListAtIndex(
      textList,
      textListForInsertion,
      insertionIndex
    );
    textList = TextList.consolidate(textList);

    let dom = deserialize(textList);

    editorNode.replaceChildren(dom);
  }
});

editorNode.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    document.execCommand("insertLineBreak");
    event.preventDefault();
  }
});

function toggleAttr(attrName) {
  let textList = serialize(editorNode);

  let range = window.getSelection().getRangeAt(0).cloneRange();
  let startPosition = findLocationFromContainerAndOffset(
    range.startContainer,
    range.startOffset
  );
  let endPosition = findLocationFromContainerAndOffset(
    range.endContainer,
    range.endOffset
  );
  let [
    _textList,
    startSelectionIndex,
    endSelectionIndex,
  ] = TextList.splitAtRange(textList, startPosition, endPosition);

  let selectedHasAttr = true;
  for (let i = startSelectionIndex; i <= endSelectionIndex; i++) {
    if (!_textList[i].attrs[attrName]) {
      selectedHasAttr = false;
      break;
    }
  }
  for (let i = startSelectionIndex; i <= endSelectionIndex; i++) {
    _textList[i].attrs[attrName] = !selectedHasAttr;
  }

  _textList = TextList.consolidate(_textList);
  editorNode.replaceChildren(deserialize(_textList));
}

const head1Button = document.getElementById("head-1-button");
head1Button.addEventListener("click", (e) => {
  let textList = serialize(editorNode);

  let range = window.getSelection().getRangeAt(0).cloneRange();
  let startPosition = findLocationFromContainerAndOffset(
    range.startContainer,
    range.startOffset
  );
  let endPosition = findLocationFromContainerAndOffset(
    range.endContainer,
    range.endOffset
  );

  let [
    _textList,
    startSelectionIndex,
    endSelectionIndex,
  ] = TextList.splitAtRange(textList, startPosition, endPosition);

  for (let i = startSelectionIndex; i <= endSelectionIndex; i++) {
    _textList[i].attrs.header = 1;
  }

  editorNode.replaceChildren(deserialize(TextList.consolidate(_textList)));
});

const head2Button = document.getElementById("head-2-button");
head2Button.addEventListener("click", (e) => {
  let textList = serialize(editorNode);

  let range = window.getSelection().getRangeAt(0).cloneRange();

  let startPosition = findLocationFromContainerAndOffset(
    range.startContainer,
    range.startOffset
  );
  let endPosition = findLocationFromContainerAndOffset(
    range.endContainer,
    range.endOffset
  );

  let [
    _textList,
    startSelectionIndex,
    endSelectionIndex,
  ] = TextList.splitAtRange(textList, startPosition, endPosition);

  for (let i = startSelectionIndex; i <= endSelectionIndex; i++) {
    _textList[i].attrs.header = 2;
  }

  editorNode.replaceChildren(deserialize(TextList.consolidate(_textList)));
});

const boldButton = document.getElementById("bold-button");
boldButton.addEventListener("click", (e) => {
  toggleAttr("bold");
});

const italicButton = document.getElementById("italic-button");
italicButton.addEventListener("click", (e) => {
  toggleAttr("italic");
});
