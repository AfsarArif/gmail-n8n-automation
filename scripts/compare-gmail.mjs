const BASE = "http://localhost:5678";
async function main() {
  const login = await fetch(BASE + "/rest/login", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({emailOrLdapLoginId: "mohamedafsar.arif@gmail.com", password: "TempPass123"})
  });
  const cookies = login.headers.getSetCookie?.() ?? [];
  const cookie = cookies.map(c => c.split(";")[0]).join("; ");

  const list = await (await fetch(BASE + "/rest/workflows", {headers: {Cookie: cookie}})).json();

  // Get WF-4 Gmail node
  const wf4 = (list.data || []).find(w => w.name?.includes("WF-4") && w.active);
  const r4 = await fetch(BASE + "/rest/workflows/" + wf4.id, {headers: {Cookie: cookie}});
  const d4 = (await r4.json()).data;
  const gmailNode = d4.nodes.find(n => n.type === "n8n-nodes-base.gmail");
  console.log("WF-4 Gmail node:", gmailNode.name);
  console.log("  credentials:", JSON.stringify(gmailNode.credentials));
  console.log("  params keys:", Object.keys(gmailNode.parameters).join(", "));
  console.log("  operation:", gmailNode.parameters.operation);
  console.log("  resource:", gmailNode.parameters.resource);

  // Get WF-1 Gmail Trigger node for comparison
  const wf1 = (list.data || []).find(w => w.name?.includes("WF-1"));
  if (wf1) {
    const r1 = await fetch(BASE + "/rest/workflows/" + wf1.id, {headers: {Cookie: cookie}});
    const d1 = (await r1.json()).data;
    const gmailTrig = d1.nodes.find(n => n.type === "n8n-nodes-base.gmailTrigger");
    if (gmailTrig) {
      console.log("\nWF-1 Gmail Trigger:", gmailTrig.name);
      console.log("  credentials:", JSON.stringify(gmailTrig.credentials));
    }

    // Check if WF-1 has any gmail action nodes (not trigger)
    const gmailActions = d1.nodes.filter(n => n.type === "n8n-nodes-base.gmail");
    gmailActions.forEach(n => {
      console.log("\nWF-1 Gmail Action:", n.name);
      console.log("  credentials:", JSON.stringify(n.credentials));
      console.log("  operation:", n.parameters?.operation);
    });
  }
}
main().catch(e => console.error(e));
