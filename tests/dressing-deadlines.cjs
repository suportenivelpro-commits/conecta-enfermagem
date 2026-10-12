const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync("src/app/page.tsx", "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(name, node = ast) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === name) return node.getText(ast);
  return ts.forEachChild(node, child => find(name, child));
}
const context = vm.createContext({ Date });
vm.runInContext(ts.transpile(["safeDate", "dayNumber", "addDays", "dressingStatus"].map(name => find(name)).join("\n")), context);
for (const duration of [1, 3, 7]) {
  const due = context.addDays("2026-10-11", duration - 1);
  const atDue = context.dressingStatus("2026-10-11", duration, due);
  assert.equal(atDue.key, duration === 1 ? "ok" : "today");
  assert.equal(atDue.day, duration);
  assert.equal(atDue.due, due);
  assert.equal(context.dressingStatus("2026-10-11", duration, context.addDays(due, 1)).key, "late");
  if (duration > 1) {
    assert.equal(context.dressingStatus("2026-10-11", duration, context.addDays(due, -1)).key, "soon");
  }
}
const oneDay = context.dressingStatus("2026-10-11", 1, "2026-10-11");
assert.equal(oneDay.label, "No prazo · válido até hoje");
assert.equal(oneDay.color, "#15803d");
const nextDay = context.dressingStatus("2026-10-11", 1, "2026-10-12");
assert.equal(nextDay.key, "late");
assert.equal(nextDay.label, "Vencido há 1 dia");
assert.equal(context.dressingStatus("2026-10-11", 7, "2026-10-11").key, "ok");
assert.equal(context.dressingStatus(null, null, "2026-10-11").key, "unknown");
assert.equal(context.dressingStatus("2026-10-11", 2, "2026-10-11").key, "unknown");
assert.equal(context.dressingStatus("2026-10-12", 3, "2026-10-11").key, "future");
assert.equal(context.dressingStatus("2026-12-31", 3, "2027-01-02").key, "today");
assert.equal(context.dressingStatus("2028-02-28", 3, "2028-03-01").key, "today");
console.log("OK: prazos de 1/3/7 dias com Dia 1 inclusivo, vencimento, data ausente/futura, virada de ano e ano bissexto.");
