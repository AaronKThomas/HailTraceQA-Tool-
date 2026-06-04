export function createEmptyPageInfo() {
  return {
    title: "",
    h1Count: 0,
    isLikelySpa: false,
    imagesMissingAlt: 0,
    controlsMissingName: 0,
    inputsMissingLabel: 0,
    links: [],
  };
}

export async function collectPageInfo(page) {
  return page.evaluate(() => {
    const hasAccessibleName = (element) => Boolean(
      element.getAttribute("aria-label")
      || element.getAttribute("aria-labelledby")
      || element.getAttribute("title")
      || element.textContent?.trim()
      || element.getAttribute("value"),
    );
    const hasLabel = (element) => Boolean(
      element.getAttribute("aria-label")
      || element.getAttribute("aria-labelledby")
      || (element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`))
      || element.closest("label"),
    );

    return {
      title: document.title.trim(),
      h1Count: document.querySelectorAll("h1").length,
      isLikelySpa: Boolean(document.querySelector(
        "#root, #app, #__next, [data-reactroot], [data-reactid], [ng-version]",
      )),
      imagesMissingAlt: [...document.images].filter((image) => !image.hasAttribute("alt")).length,
      controlsMissingName: [...document.querySelectorAll("button, input[type='button'], input[type='submit']")]
        .filter((element) => !hasAccessibleName(element)).length,
      inputsMissingLabel: [...document.querySelectorAll("input:not([type='hidden']):not([type='button']):not([type='submit']), textarea, select")]
        .filter((element) => !hasLabel(element)).length,
      links: [...document.querySelectorAll("a[href]")].map((anchor) => anchor.href),
    };
  });
}
