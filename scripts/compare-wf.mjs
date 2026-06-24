const BASE = "http://localhost:5678";
async function main() {
  const login = await fetch(BASE + "/rest/login", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({emailOrLdapLoginId: "mohamedafsar.arif@gmail.com", password: "TempPass123"})
  });
  const cookies = login.headers.getSetCookie?.() ?? [];
  const cookie = cookies.map(c => c.split(";")[0]).join("; ");

  const list = await (await fetch(BASE + "/rest/workflows", {headers: {Cookie: cookie}})).json();
  const wf0 = (list.data || []).find(w => w.name?.includes("WF-0"));
  const wf4 = (list.data || []).find(w => w.name?.includes("WF-4") && w.active);

  // Fetch full workflows
  const [r0, r4] = await Promise.all([
    fetch(BASE + "/rest/workflows/" + wf0.id, {headers: {Cookie: cookie}}),
    fetch(BASE + "/rest/workflows/" + wf4.id, {headers: {Cookie: cookie}})
  ]);
  const d0 = (await r0.json()).data;
  const d4 = (await r4.json()).data;

  console.log("=== WF-0 (working) ===");
  console.log("Settings:", JSON.stringify(d0.settings));
  console.log("Node 0:", JSON.stringify({name:d0.nodes[0]?.name, type:d0.nodes[0]?.type, pos:d0.nodes[0]?.position}));
  console.log("Connections:", JSON.stringify(d0.connections).slice(0,200));
  console.log("Node count:", d0.nodes.length);
  console.log("Has staticData:", !!d0.staticData);
  console.log("Has versionId:", d0.versionId);

  console.log("\n=== WF-4 (our) ===");
  console.log("Settings:", JSON.stringify(d4.settings));
  console.log("Node 0:", JSON.stringify({name:d4.nodes[0]?.name, type:d4.nodes[0]?.type, pos:d4.nodes[0]?.position}));
  console.log("Connections:", JSON.stringify(d4.connections).slice(0,200));
  console.log("Node count:", d4.nodes.length);
  console.log("Has staticData:", !!d4.staticData);
  console.log("Has versionId:", d4.versionId);
}
main().catch(e => console.error(e));
