import "@logseq/libs";
import { LintConfig, Linter, Suggestion, LocalLinter, Dialect, SuggestionKind, Lint } from "harper.js/dist/index";
// Important: In 2.0, the binary is imported from its own subpath
import { binary } from "harper.js/dist/binary";
import { dialects, getSettingsSchema } from "./settings";

type CBlock = {
  id: string;
  value: string;
  element?: Element | null;
};

var linter: LocalLinter;

/**
 * Main Linter Logic
 */
async function lintBlockContent(block: CBlock) {
  parent.document.getElementById("harper-suggestions")?.remove();

  // Harper 2.0 returns a Promise of Lint[]
  const issues = await linter.lint(block.value);
  insertLintOverlay(block, issues);
}

function insertLintOverlay(block: CBlock, issues: Lint[]) {
  const blockElement = parent.document.querySelector(`[blockid="${block.id}"]`) as HTMLElement;
  if (!blockElement) return;

  let harperDiv = blockElement.querySelector(`[id="harper-${block.id}"]`) as HTMLElement;
  if (!harperDiv) {
    harperDiv = document.createElement("div");
    harperDiv.id = `harper-${block.id}`;
    blockElement.querySelector(".editor-inner")?.appendChild(harperDiv);
  }

  harperDiv.innerHTML = block.value;
  harperDiv.classList.remove(...harperDiv.classList);
  harperDiv.classList.add("harper-ls-text");

  const textarea = blockElement.querySelector("textarea");
  if (textarea) {
    harperDiv.classList.add(...textarea.classList);
  }

  harperDiv.addEventListener("click", (event) => {
    event.preventDefault();
    textarea?.focus();
  });

  let overlay = "";
  let currentIdx = 0;
  const text = block.value;

  for (let j = 0; j < text.length; j++) {
    let currentIssue = issues[currentIdx];
    if (!currentIssue) break;

    if (j < currentIssue.span().start) {
      overlay += text[j];
      continue;
    }
    overlay += highlightIssue(text, currentIssue, currentIdx);
    currentIdx++;
    j = currentIssue.span().end - 1;
  }

  harperDiv.innerHTML = overlay.replace(/\n/g, "<br/>");

  for (let j = 0; j < issues.length; j++) {
    addContextMenu(j, block, issues[j]);
  }
}

function openMenu(event: MouseEvent, block: CBlock, issue: Lint) {
  const menu = document.createElement("div");
  menu.id = "harper-suggestions";
  menu.style.position = "fixed";
  menu.style.top = `${event.clientY}px`;
  menu.style.left = `${event.clientX}px`;
  menu.classList.add("menu-links-wrapper");

  menu.innerHTML = `<b>${issue.lint_kind_pretty()}</b><br/>${issue.message()}<hr class="menu-separator">`;

  if (issue.lint_kind() === "Spelling") {
    const addToDictOpt = document.createElement("a");
    addToDictOpt.classList.add("flex", "justify-between", "menu-link");
    addToDictOpt.innerHTML = `<span class="flex-1">Add to dictionary</span>`;
    addToDictOpt.onclick = () => addWordToDictionary(block, issue);
    menu.appendChild(addToDictOpt);
  }

  issue.suggestions().forEach((element: Suggestion) => {
    const opt = document.createElement("a");
    opt.classList.add("flex", "justify-between", "menu-link");

    let label = "Insert ";
    if (element.kind() === SuggestionKind.Replace) label = "Replace with ";
    if (element.kind() === SuggestionKind.Remove) label = "Remove ";

    opt.innerHTML = `<span class="flex-1">${label} "${element.get_replacement_text()}"</span>`;
    opt.onclick = () => applySuggestion(block, issue, element);
    menu.appendChild(opt);
  });

  parent.document.body.appendChild(menu);

  const close = () => {
    menu.remove();
    parent.removeEventListener("click", close);
  };
  setTimeout(() => parent.addEventListener("click", close), 0);
}

async function applySuggestion(block: CBlock, issue: Lint, element: Suggestion) {
  const span = issue.span();
  let newValue = "";

  switch (element.kind()) {
    case SuggestionKind.InsertAfter:
      newValue = block.value.substring(0, span.end) + element.get_replacement_text() + block.value.substring(span.end);
      break;
    case SuggestionKind.Remove:
      newValue = block.value.substring(0, span.start) + block.value.substring(span.end);
      break;
    case SuggestionKind.Replace:
      newValue =
        block.value.substring(0, span.start) + element.get_replacement_text() + block.value.substring(span.end);
      break;
  }

  await logseq.Editor.updateBlock(block.id, newValue);
  logseq.UI.showMsg("Fix applied ✅", "success");
}

async function addWordToDictionary(block: CBlock, issue: Lint) {
  const word = block.value.substring(issue.span().start, issue.span().end).toLowerCase();
  let userDict: string[] = JSON.parse(logseq.settings?.HarperUserDictionary || "[]");

  if (!userDict.includes(word)) {
    userDict.push(word);
    logseq.updateSettings({ HarperUserDictionary: JSON.stringify(userDict) });
    await linter.importWords([word]);
  }

  logseq.UI.showMsg(`Added "${word}" to dictionary ✅`, "success");
  parent.document.getElementById("harper-suggestions")?.remove();
  lintBlockContent(block);
}

function highlightIssue(blockText: string, issue: Lint, id: number): string {
  const word = blockText.substring(issue.span().start, issue.span().end);
  const type = issue.lint_kind() === "Spelling" ? "lint-error" : "lint-warning";
  return `<span id="harper-issue-${id}" class="${type}">${word}</span>`;
}

function addContextMenu(id: number, block: CBlock, issue: Lint) {
  const element = parent.document.getElementById(`harper-issue-${id}`);
  if (!element) return;

  element.title = issue.message();
  element.oncontextmenu = (event: MouseEvent) => {
    event.preventDefault();
    if (issue.suggestion_count() > 0) {
      openMenu(event, block, issue);
    } else {
      logseq.UI.showMsg("No quick fixes available.", "info");
    }
  };
}

/**
 * Plugin Infrastructure
 */
function setupEditingDetection() {
  const debounce = (func: Function, delay: number) => {
    let timer: any;
    return (...args: any[]) => {
      clearTimeout(timer);
      timer = setTimeout(() => func(...args), delay);
    };
  };

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      const target = mutation.target as HTMLElement;
      if (mutation.type === "childList") {
        let blockId: string | null = null;
        let value = "";

        if (target.nodeName === "TEXTAREA") {
          blockId = target.closest("[blockid]")?.getAttribute("blockid") || null;
          value = (target as HTMLTextAreaElement).value;
        } else if (target.classList?.contains("editor-wrapper")) {
          blockId = target.closest("[blockid]")?.getAttribute("blockid") || null;
          value = target.querySelector("textarea")?.value || "";
        }

        if (blockId) {
          const run = debounce(() => lintBlockContent({ id: blockId!, value }), 300);
          run();
        }
      }
    });
  });

  observer.observe(parent.document.body, { childList: true, subtree: true });
}

async function updateHarperSettings() {
  if (!linter) return;

  // Set Dialect
  const dialectKey = logseq.settings?.HarperDialect;
  if (dialectKey && dialects[dialectKey]) {
    await linter.setDialect(dialects[dialectKey]);
  }

  // Load user dictionary
  const userWords = JSON.parse(logseq.settings?.HarperUserDictionary || "[]");
  if (userWords.length > 0) {
    await linter.importWords(userWords);
  }

  // Map settings to LintConfig
  const conf: LintConfig = {};
  for (const key in logseq.settings) {
    if (key.startsWith("HarperRule")) {
      conf[key.substring(10)] = logseq.settings[key];
    }
  }
  await linter.setLintConfig(conf);
}

function main() {
  logseq.provideStyle(`
    .lint-warning { text-decoration: green wavy underline; visibility: visible !important; pointer-events: auto; }
    .lint-error { text-decoration: red wavy underline; visibility: visible !important; pointer-events: auto; }
    .harper-ls-text { 
      width: 100%; height: 100%; position: absolute; top: 0; left: 0; 
      color: transparent; pointer-events: none; white-space: pre-wrap;
    }
    .menu-links-wrapper { background: var(--ls-primary-background-color); border: 1px solid var(--ls-border-color); z-index: 9999; }
  `);

  setupEditingDetection();

  logseq.onSettingsChanged(() => updateHarperSettings());
}

// 2.0 Initialization
linter = new LocalLinter({ binary });

getSettingsSchema(linter).then((schema) => {
  logseq
    .useSettingsSchema(schema)
    .ready(() => {
      updateHarperSettings().then(main);
    })
    .catch(console.error);
});
