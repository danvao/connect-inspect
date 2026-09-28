import fs from "node:fs";

const popupHtml = fs.readFileSync(new URL("../popup.html", import.meta.url), "utf8");
const sidePanelHtml = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
const popupJs = fs.readFileSync(new URL("../popup.js", import.meta.url), "utf8");

if (popupHtml !== sidePanelHtml) {
  throw new Error("popup.html and sidepanel.html must stay identical.");
}

const referencedIds = [...popupJs.matchAll(/document\.getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
const compatibilityOnlyIds = new Set(["resetSkippedCalls"]);
const missingIds = [...new Set(referencedIds)].filter((id) => {
  return !compatibilityOnlyIds.has(id) && !sidePanelHtml.includes(`id="${id}"`);
});

if (missingIds.length) {
  throw new Error(`Missing UI elements: ${missingIds.join(", ")}`);
}

for (const requiredId of ["captureDetail", "captureNetworkTranscript", "actionIssueButton", "actionIssueDetails"]) {
  if (!sidePanelHtml.includes(`id="${requiredId}"`)) {
    throw new Error(`Missing contextual download control: ${requiredId}`);
  }
}

console.log(JSON.stringify({
  status: "ok",
  referencedElementCount: new Set(referencedIds).size - compatibilityOnlyIds.size,
  contextualActions: 4
}, null, 2));
