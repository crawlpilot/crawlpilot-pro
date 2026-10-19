# Element: querySelectorAll() method

**Baseline Widely available**

This feature is well established and works across many devices and browser versions. It’s been available across browsers since July 2015.

The [`Element`](http://localhost:3000/en-US/docs/Web/API/Element) method **`querySelectorAll()`** returns a static (not live) [`NodeList`](http://localhost:3000/en-US/docs/Web/API/NodeList) representing a list of elements matching the specified group of selectors which are descendants of the element on which the method was called.

## Syntax

js

```js
querySelectorAll(selectors)
```

### Parameters

**`selectors`**
: A string containing one or more selectors to match. This string must be a valid CSS selector string; if it isn't, a `SyntaxError` exception is thrown. Note that the HTML specification does not require attribute values to be valid CSS identifiers. If a [`class`](http://localhost:3000/en-US/docs/Web/HTML/Reference/Global_attributes/class) or [`id`](http://localhost:3000/en-US/docs/Web/HTML/Reference/Global_attributes/id) attribute value is not a valid CSS identifier, then you must escape it before using it in a selector, either by calling [`CSS.escape()`](http://localhost:3000/en-US/docs/Web/API/CSS/escape_static "CSS.escape()") on the value, or using one of the techniques described in [Escaping characters](http://localhost:3000/en-US/docs/Web/CSS/Reference/Values/ident#escaping_characters). See Escaping attribute values for an example. The selectors are applied to the entire document, not just the particular element on which `querySelectorAll()` is called. To restrict the selector to the element on which `querySelectorAll()` is called, include the [`:scope`](http://localhost:3000/en-US/docs/Web/CSS/Reference/Selectors/:scope) pseudo-class at the start of the selector. See the selector scope example.

### Return value

A non-live [`NodeList`](http://localhost:3000/en-US/docs/Web/API/NodeList) containing one [`Element`](http://localhost:3000/en-US/docs/Web/API/Element) object for each descendant node that matches at least one of the specified selectors. The elements are in document order — that is, parents before children, earlier siblings before later siblings.

**Note:** If the specified `selectors` include a [CSS pseudo-element](http://localhost:3000/en-US/docs/Web/CSS/Reference/Selectors/Pseudo-elements), the returned list is always empty.

### Exceptions

**`SyntaxError` [`DOMException`](http://localhost:3000/en-US/docs/Web/API/DOMException)**
: Thrown if the syntax of the specified `selectors` string is not valid.

### Getting all elements with a custom data value

This example uses the [attribute selector](http://localhost:3000/en-US/docs/Web/CSS/Reference/Selectors/Attribute_selectors) to select multiple elements with a `data-name` data attribute that contains "funnel-chart-percent".

html

```html
<section class="box" id="sect1">
  <div data-name="funnel-chart-percent1">10.900%</div>
  <div data-name="funnel-chart-percent2">3700.00%</div>
  <div data-name="funnel-chart-percent3">0.00%</div>
</section>
```

js

```js
const refs = [\
  ...document.querySelectorAll(`[data-name*="funnel-chart-percent"]`),\
];
```

### Obtaining a list of matches

To obtain a [`NodeList`](http://localhost:3000/en-US/docs/Web/API/NodeList) of all of the [`<p>`](http://localhost:3000/en-US/docs/Web/HTML/Reference/Elements/p) elements contained within the element `myBox`:

js

```js
const matches = myBox.querySelectorAll("p");
```

This example returns a list of all [`<div>`](http://localhost:3000/en-US/docs/Web/HTML/Reference/Elements/div) elements within `myBox` with a class of either `note` or `alert`:

js

```js
const matches = myBox.querySelectorAll("div.note, div.alert");
```

Here, we get a list of the document's `<p>` elements whose immediate parent element is a [`<div>`](http://localhost:3000/en-US/docs/Web/HTML/Reference/Elements/div) with the class `"highlighted"` and which are located inside a container whose ID is `"test"`.

js

```js
const container = document.querySelector("#test");
const matches = container.querySelectorAll("div.highlighted > p");
```

This example uses an [attribute selector](http://localhost:3000/en-US/docs/Web/CSS/Reference/Selectors/Attribute_selectors) to return a list of the [`<iframe>`](http://localhost:3000/en-US/docs/Web/HTML/Reference/Elements/iframe) elements in the document that contain an attribute named `"data-src"`:

js

```js
const matches = document.querySelectorAll("iframe[data-src]");
```

Here, an attribute selector is used to return a list of the list items contained within a list whose ID is `"user-list"` which have a `"data-active"` attribute whose value is `"1"`:

js

```js
const container = document.querySelector("#user-list");
const matches = container.querySelectorAll("li[data-active='1']");
```

### Accessing the matches

Once the [`NodeList`](http://localhost:3000/en-US/docs/Web/API/NodeList) of matching elements is returned, you can examine it just like any array. If the array is empty (that is, its `length` property is `0`), then no matches were found.

Otherwise, you can use standard array notation to access the contents of the list. You can use any common looping statement, such as:

```js
const highlightedItems = userList.querySelectorAll(".highlighted");

highlightedItems.forEach((userItem) => {
  deleteUser(userItem);
});
```

**Note:** `NodeList` is not a genuine array, that is to say it doesn't have array methods like `slice`, `some`, `map`, etc. To convert it into an array, try `Array.from(nodeList)`.

### Selector scope

The `querySelectorAll()` method applies its selectors to the whole document: they are not scoped to the element on which the method is called. To scope the selectors, include the [`:scope`](http://localhost:3000/en-US/docs/Web/CSS/Reference/Selectors/:scope) pseudo-class at the start of the selector string.

#### HTML

In this example the HTML contains:

- two buttons: `#select` and `#select-scope`
- three nested `<div>` elements: `#outer`, `#subject`, and `#inner`
- a `<pre>` element which the example uses for output.

html

```html
<button id="select">Select</button>
<button id="select-scope">Select with :scope</button>

<div id="outer">
  #outer
  <div id="subject">
    #subject
    <div id="inner">#inner</div>
  </div>
</div>

<pre id="output"></pre>
```

```css
div {
  margin: 0.5rem;
  padding: 0.5rem;
  border: 3px lightseagreen solid;
  border-radius: 5px;
  font-family: monospace;
}

pre,
button {
  margin: 0.5rem;
  padding: 0.5rem;
}
```

#### JavaScript

In the JavaScript, we first select the `#subject` element.

When the `#select` button is pressed, we call `querySelectorAll()` on `#subject`, passing `"#outer #inner"` as the selector string.

When the `#select-scope` button is pressed, we again call `querySelectorAll()` on `#subject`, but this time we pass `":scope #outer #inner"` as the selector string.

js

```js
const subject = document.querySelector("#subject");

const select = document.querySelector("#select");
select.addEventListener("click", () => {
  const selected = subject.querySelectorAll("#outer #inner");
  output.textContent = `Selection count: ${selected.length}`;
});

const selectScope = document.querySelector("#select-scope");
selectScope.addEventListener("click", () => {
  const selected = subject.querySelectorAll(":scope #outer #inner");
  output.textContent = `Selection count: ${selected.length}`;
});
```

#### Result

When we press "Select", the selector selects all elements with an ID of `inner` that also have an ancestor with an ID of `outer`. Note that even though `#outer` is outside the `#subject` element, it is still used in selection, so our `#inner` element is found.

When we press "Select with :scope", the `:scope` pseudo-class restricts the selector scope to `#subject`, so `#outer` is not used in selector matching, and we don't find the `#inner` element.

### Escaping attribute values

This example shows that if an HTML document contains an [`id`](http://localhost:3000/en-US/docs/Web/HTML/Reference/Global_attributes/id) which is not a valid [CSS identifier](http://localhost:3000/en-US/docs/Web/CSS/Reference/Values/ident), then we must escape the attribute value before using it in `querySelectorAll()`.

#### HTML

In the following code, a [`<div>`](http://localhost:3000/en-US/docs/Web/HTML/Reference/Elements/div) element has an `id` of `"this?element"`, which is not a valid CSS identifier, because the `"?"` character is not allowed in CSS identifiers.

We also have three buttons, and a [`<pre>`](http://localhost:3000/en-US/docs/Web/HTML/Reference/Elements/pre) element for logging errors.

html

```html
<div id="container">
  <div id="this?element"></div>
</div>

<button id="no-escape">No escape</button>
<button id="css-escape">CSS.escape()</button>
<button id="manual-escape">Manual escape</button>

<pre id="log"></pre>
```

#### CSS

css

```css
div {
  background-color: blue;
  margin: 1rem 0;
  height: 100px;
  width: 200px;
}
```

#### JavaScript

All three buttons, when clicked, try to select the `<div>`, and then set its background color to a random value.

- The first button uses the `"this?element"` value directly.
- The second button escapes the value using [`CSS.escape()`](http://localhost:3000/en-US/docs/Web/API/CSS/escape_static "CSS.escape()").
- The third button explicitly escapes the `"?"` character using a backslash. Note that we must also escape the backslash itself, using another backslash, like: `"\\?"`.

```js
const container = document.querySelector("#container");
const log = document.querySelector("#log");

function random(number) {
  return Math.floor(Math.random() * number);
}

function setBackgroundColor(id) {
  log.textContent = "";

  try {
    const elements = container.querySelectorAll(`#${id}`);
    const randomColor = `rgb(${random(255)} ${random(255)} ${random(255)})`;
    elements[0].style.backgroundColor = randomColor;
  } catch (e) {
    log.textContent = e;
  }
}

document.querySelector("#no-escape").addEventListener("click", () => {
  setBackgroundColor("this?element");
});

document.querySelector("#css-escape").addEventListener("click", () => {
  setBackgroundColor(CSS.escape("this?element"));
});

document.querySelector("#manual-escape").addEventListener("click", () => {
  setBackgroundColor("this\\?element");
});
```

#### Result

Clicking the first button gives an error, while the second and third buttons work properly.

## Specifications

| Specification |
| --- |
| [DOM \# ref-for-dom-parentnode-queryselectorall①](https://dom.spec.whatwg.org/#ref-for-dom-parentnode-queryselectorall%E2%91%A0) |

## Browser compatibility

## See also

- [Attribute selectors](http://localhost:3000/en-US/docs/Web/CSS/Reference/Selectors/Attribute_selectors) in the CSS Guide
- [Attribute selectors](http://localhost:3000/en-US/docs/Learn_web_development/Core/Styling_basics/Attribute_selectors) in the MDN Learning Area
- [`Document.querySelector()`](http://localhost:3000/en-US/docs/Web/API/Document/querySelector) and [`Document.querySelectorAll()`](http://localhost:3000/en-US/docs/Web/API/Document/querySelectorAll)
- [`DocumentFragment.querySelector()`](http://localhost:3000/en-US/docs/Web/API/DocumentFragment/querySelector) and [`DocumentFragment.querySelectorAll()`](http://localhost:3000/en-US/docs/Web/API/DocumentFragment/querySelectorAll)

## Help improve MDN

[Learn how to contribute](http://localhost:3000/en-US/docs/MDN/Community/Getting_started)

This page was last modified on Dec 17, 2025 by [MDN contributors](http://localhost:3000/en-US/docs/Web/API/Element/querySelectorAll/contributors.txt).
