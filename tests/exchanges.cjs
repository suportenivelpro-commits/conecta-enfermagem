const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/app/page.tsx", "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findFunction(name, node = ast) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === name) return node.getText(ast);
  return ts.forEachChild(node, child => findFunction(name, child));
}

function setup(overrides = {}, rpcError = null) {
  const calls = [];
  const result = {};
  const context = vm.createContext({
    busy: false,
    staff: { full_name: "Profissional de teste" },
    exchangeKind: "connector",
    exchangeCatheterType: "Permcath",
    exchangeDressingDays: "3",
    exchangeProfessional: " Profissional de teste ",
    exchangeReason: " Troca por obstrução ",
    exchangeNotes: " Observação ",
    dischargePatientId: "patient-test",
    activePatients: [{ id: "patient-test" }],
    getSupabase: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { error: rpcError }; } }),
    loadData: async () => { result.reloaded = true; },
    setBusy: value => { result.busy = value; },
    setError: value => { result.error = value; },
    setNotice: value => { result.notice = value; },
    setExchangePatient: value => { result.modal = value; },
    setExchangeNotes: () => {},
    setExchangeReason: () => {},
    setExchangeProfessional: () => {},
    setDischargeError: value => { result.dischargeError = value; },
    setShowDischarge: value => { result.showDischarge = value; },
    setDischargePatientId: value => { result.dischargePatientId = value; },
    ...overrides,
  });
  vm.runInContext(ts.transpile(["errorMessage", "registerExchange", "registerDischarge"].map(name => findFunction(name)).join("\n")), context);
  return { context, calls, result };
}

(async () => {
  const connector = setup();
  await connector.context.registerExchange({ id: "patient-test" });
  assert.equal(connector.calls[0].name, "register_connector_exchange");
  assert.equal(connector.calls[0].args.p_professional_name, "Profissional de teste");
  assert.equal(connector.calls[0].args.p_reason, "Troca por obstrução");
  assert.equal(connector.calls[0].args.p_notes, "Observação");
  assert.equal("p_catheter_type" in connector.calls[0].args, false);
  assert.equal(connector.result.reloaded, true);
  assert.equal(connector.result.modal, null);

  const catheter = setup({ exchangeKind: "catheter" });
  await catheter.context.registerExchange({ id: "patient-test" });
  assert.equal(catheter.calls[0].name, "register_catheter_with_dressing");
  assert.equal(catheter.calls[0].args.p_catheter_type, "Permcath");
  assert.equal(catheter.calls[0].args.p_dressing_duration_days, 3);
  assert.match(catheter.result.notice, /novo Dia 1/);
  assert.equal(catheter.result.reloaded, true);

  const dressing = setup({ exchangeKind: "dressing", exchangeDressingDays: "7" });
  await dressing.context.registerExchange({ id: "patient-test" });
  assert.equal(dressing.calls[0].name, "register_dressing_exchange");
  assert.equal(dressing.calls[0].args.p_dressing_duration_days, 7);
  assert.equal("p_catheter_type" in dressing.calls[0].args, false);
  assert.equal(dressing.result.reloaded, true);

  const noDressing = setup({ exchangeKind: "catheter", exchangeDressingDays: "" });
  await noDressing.context.registerExchange({ id: "patient-test" });
  assert.equal(noDressing.calls.length, 0);
  assert.equal(noDressing.result.error, "Selecione um curativo de 1, 3 ou 7 dias.");

  const invalid = setup({ exchangeKind: "catheter", exchangeReason: " " });
  await invalid.context.registerExchange({ id: "patient-test" });
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.result.error, "Selecione o motivo da troca.");

  const failure = setup({ exchangeKind: "catheter" }, { message: "Acesso não autorizado." });
  await failure.context.registerExchange({ id: "patient-test" });
  assert.equal(failure.result.error, "Acesso não autorizado.");
  assert.equal(failure.result.busy, false);
  assert.equal(failure.result.reloaded, undefined);
  assert.equal(failure.result.modal, undefined);

  const busy = setup({ busy: true });
  await busy.context.registerExchange({ id: "patient-test" });
  assert.equal(busy.calls.length, 0);

  const discharge = setup();
  await discharge.context.registerDischarge({ preventDefault() {} });
  assert.equal(discharge.calls[0].name, "close_connector_follow_up");
  assert.equal(discharge.calls[0].args.p_patient_id, "patient-test");
  assert.equal(discharge.calls[0].args.p_professional_name, "Profissional de teste");
  assert.equal(discharge.calls[0].args.p_reason, "Alta hospitalar");
  assert.equal(discharge.result.showDischarge, false);
  assert.equal(discharge.result.reloaded, true);

  const inactive = setup({ activePatients: [] });
  await inactive.context.registerDischarge({ preventDefault() {} });
  assert.equal(inactive.calls.length, 0);
  assert.equal(inactive.result.dischargeError, "Selecione um paciente em acompanhamento.");

  const denied = setup({}, { message: "Paciente não encontrado ou acompanhamento já encerrado." });
  await denied.context.registerDischarge({ preventDefault() {} });
  assert.equal(denied.result.dischargeError, "Paciente não encontrado ou acompanhamento já encerrado.");
  assert.equal(denied.result.showDischarge, undefined);
  assert.equal(denied.result.busy, false);

  const reloadFailure = setup({ loadData: async () => { throw new Error("Falha de rede"); } });
  await reloadFailure.context.registerDischarge({ preventDefault() {} });
  assert.equal(reloadFailure.result.showDischarge, false);
  assert.match(reloadFailure.result.error, /Alta registrada.*Falha de rede/);
  assert.equal(reloadFailure.result.dischargeError, "");
  console.log("OK: trocas de conector/cateter/curativo e alta, validações, falhas de RPC e atualização do painel.");
})().catch(error => { console.error(error); process.exitCode = 1; });
