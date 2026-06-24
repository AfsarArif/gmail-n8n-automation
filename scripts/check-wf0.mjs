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
  if (!wf0) { console.log("No WF-0"); return; }

  const full = await (await fetch(BASE + "/rest/workflows/" + wf0.id, {headers: {Cookie: cookie}})).json();
  const d = full.data || full;
  const webhookNode = d.nodes.find(n => n.type === "n8n-nodes-base.webhook");
  if (webhookNode) {
    console.log("WF-0 Webhook params:", JSON.stringify(webhookNode.parameters, null, 2));
  }
}
main().catch(e => console.error(e.message));
