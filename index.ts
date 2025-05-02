import "@logseq/libs";
import { LintConfig, Linter, Suggestion, LocalLinter, Dialect, binary, SuggestionKind } from "harper.js";
import { Lint } from "harper.js";
import { dialects, getSettingsSchema, settingsSchema } from "./settings";
type LintIssue = {
  message: string;
  fix?: {
    description: string;
    apply: (content: string) => string;
  };
};

type CBlock = {
  id: string;
  value: string;
  element: Element;
};

var linter: LocalLinter;
function lintBlockContent(block: CBlock) {
  parent.document.getElementById("harper-suggestions")?.remove();
  linter.lint(block.value).then((value: Lint[]) => {
    insertLintOverlay(block, value);
  });
}

function insertLintOverlay(block: CBlock, issues: Lint[]) {
  const blockElement = parent.document.querySelector(`[blockid="${block.id}"]`) as HTMLElement;
  if (!blockElement) {
    return;
  }
  var harperDiv: Element | null;
  harperDiv = blockElement.querySelector(`[id="harper-${block.id}"]`);
  if (harperDiv === null) {
    harperDiv = document.createElement("div");
    harperDiv.id = `harper-${block.id}`;
    blockElement.querySelector(".editor-inner")?.appendChild(harperDiv);
  }
  harperDiv.innerHTML = block.value;
  harperDiv.classList.remove(...harperDiv.classList);
  harperDiv.classList.add("harper-ls-text");

  harperDiv.classList.add(...blockElement.querySelector("textarea")!.classList);
  harperDiv.addEventListener("click", function (event) {
    event.preventDefault();
    blockElement.querySelector("textarea")?.focus();
  });

  let overlay = "";
  let currentIdx = 0;
  for (let j = 0; j < block.value.length; j++) {
    let currentIssue = issues[currentIdx];
    if (!currentIssue) {
      break;
    }
    if (j < currentIssue.span().start) {
      overlay += block.value[j];
      continue;
    }
    overlay += highlightIssue(block.value, currentIssue, currentIdx);
    currentIdx++;
    j = currentIssue.span().end - 1;
  }
  harperDiv.innerHTML = overlay;
  for (let j = 0; j < issues.length; j++) {
    addContextMenu(j, block, issues[j]);
  }
}

function openMenu(event: MouseEvent, block: CBlock, issue: Lint) {
  const menu = document.createElement("div");
  menu.id = "harper-suggestions";
  menu.style.position = "absolute";
  menu.style.padding = "3px";
  menu.style.top = `${event.pageY}px`;
  menu.style.left = `${event.pageX}px`;
  menu.style.borderRadius = "6px";
  menu.style.boxShadow = "0 4px 8px rgba(0,0,0,0.1)";
  menu.classList.add("menu-links-wrapper");
  menu.innerHTML += `<b>${issue.lint_kind_pretty()}</b><br/>${issue.message()}<hr class="menu-separator">`;
  issue.suggestions().forEach((element: Suggestion) => {
    const opt = document.createElement("a");
    opt.classList.add("flex", "justify-between", "menu-link");
    switch (element.kind()) {
      case SuggestionKind.Replace:
        opt.innerHTML += `<span class="flex-1">Replace with `;
        break;
      case SuggestionKind.Remove:
        opt.innerHTML += `<span class="flex-1">Remove `;
        break;
      default:
        opt.innerHTML += `<span class="flex-1">Insert `;
    }
    opt.innerHTML += `"${element.get_replacement_text()}"</span>`;
    opt.onclick = () => {
      applySuggestion(block, issue, element);
    };
    menu.appendChild(opt);
  });

  parent.document.body.appendChild(menu);
  setTimeout(() => {
    parent.addEventListener("click", function onClickOutside() {
      menu.remove();
      parent.removeEventListener("click", onClickOutside);
    });
  }, 0);
}

async function applySuggestion(block: CBlock, issue: Lint, element: Suggestion) {
  switch (element.kind()) {
    case SuggestionKind.InsertAfter:
      await logseq.Editor.updateBlock(
        block.id,
        block.value.substring(0, issue.span().end) +
          element.get_replacement_text() +
          block.value.substring(issue.span().end)
      );
      break;
    case SuggestionKind.Remove:
      await logseq.Editor.updateBlock(
        block.id,
        block.value.substring(0, issue.span().start) + block.value.substring(issue.span().end)
      );
      break;
    case SuggestionKind.Replace:
      await logseq.Editor.updateBlock(
        block.id,
        block.value.substring(0, issue.span().start) +
          element.get_replacement_text() +
          block.value.substring(issue.span().end)
      );
      break;
  }
  logseq.UI.showMsg("Fix applied ✅", "success");
}

function highlightIssue(blockText: string, issue: Lint, id: number): string {
  let word = blockText.substring(issue.span().start, issue.span().end);
  let ret = "";
  switch (issue.lint_kind()) {
    case "Spelling":
      ret = `<span id="harper-issue-${id}" class="lint-error">${word}</span>`;
      break;
    default:
      ret = `<span id="harper-issue-${id}" class="lint-warning">${word}</span>`;
  }
  return ret;
}

function addContextMenu(id: number, block: CBlock, issue: Lint) {
  let element = parent.document.getElementById(`harper-issue-${id}`);
  element!.title = issue.message();
  element!.oncontextmenu = async (event: MouseEvent) => {
    if (issue.suggestion_count() > 0) {
      openMenu(event, block, issue);
    } else {
      logseq.UI.showMsg("No quick fixes available.", "info");
    }
  };
}

function setupEditingDetection() {
  const debounce = (func, delay) => {
    var debounceTimer: number;
    return function () {
      const context = this;
      const args = arguments;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => func.apply(context, args), delay);
    };
  };
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      const target = mutation.target as HTMLElement;
      if (mutation.type === "childList") {
        var blockId;
        var value = "";
        var element;
        if (mutation.target.nodeName == "TEXTAREA") {
          const target = mutation.target as HTMLElement;
          element = mutation.target.parentElement;
          blockId = target.closest("[blockid]")?.getAttribute("blockid");
          value = target.innerHTML;
        } else if (target.classList.contains("editor-wrapper")) {
          blockId = target.closest("[blockid]")?.getAttribute("blockid");
          value = target.getElementsByTagName("textarea")[0]?.textContent || "";
        }
        if (blockId) {
          const send = debounce(() => lintBlockContent({ id: blockId, value: value, element: element }), 300);
          send();
        }
      }
    });
  });
  observer.observe(parent.document.body, { childList: true, subtree: true });
}

function main() {
  console.log("Harper-ls plugin loaded");
  updateHarperSettings();
  setupEditingDetection();
  logseq.provideStyle(`
.lint-warning {
  text-decoration: green wavy underline;
  visibility:visible !important;
  pointer-events:auto;
}
.lint-error {
  text-decoration: red wavy underline;
  visibility:visible !important;
  pointer-events:auto;
}
.harper-ls-text{
    width: 100%;
    height: 100%;
    position: absolute;
    top: 0px;
    left: 0px;
    color:rgba(0,0,0,0);
    pointer-events: none; /* Important: allow clicks to pass through */
}
`);
  logseq.App.onCurrentGraphChanged(() => {
    console.log("Graph changed, restarting linter");
    setupEditingDetection();
  });

  logseq.onSettingsChanged(() => {
    updateHarperSettings();
  });
}

function initializeHarper(): LocalLinter {
  const ret = new LocalLinter({ binary: binary });
  return ret;
}

function updateHarperSettings() {
  if (logseq.settings!.HarperCustomDictionary && logseq.settings!.HarperCustomDictionary != "") {
    loadFromFile(logseq.settings!.HarperCustomDictionary).then((words) => {
      linter.importWords(words);
    });
  }
  linter.setDialect(dialects[logseq.settings!.HarperDialect]);
  var conf: LintConfig = {};
  for (const setting of Object.keys(logseq.settings!)) {
    if (setting.startsWith("HarperRule")) {
      conf[setting.substring(10)] = logseq.settings![setting];
    }
  }
  linter.setLintConfig(conf);
}

async function loadFromFile(path: string): Promise<string[]> {
  try {
    const response = await fetch(`file://${path}`);
    if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);
    const text = await response.text();
    const lines = text.split("\n").map((line) => line.trimEnd());
    return lines;
  } catch (error) {
    console.error("Error reading file:", error);
    throw error;
  }
}

linter = initializeHarper();
getSettingsSchema(linter).then((settings) => {
  logseq.useSettingsSchema(settings).ready(main).catch(console.error);
});
