const BASE = "http://localhost:5678";
async function main() {
  const login = await fetch(BASE + "/rest/login", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({emailOrLdapLoginId: "mohamedafsar.arif@gmail.com", password: "TempPass123"})
  });
  const cookies = login.headers.getSetCookie?.() ?? [];
  const cookie = cookies.map(c => c.split(";")[0]).join("; ");

  const list = await (await fetch(BASE + "/rest/workflows", {headers: {Cookie: cookie}})).json();
  const all = list.data || [];
  console.log("Total workflows:", all.length);
  all.forEach(w => console.log(" -", w.id, "active:", w.active, "name:", w.name?.slice(0,60)));

  // Show all WF-4 executions across all WF-4s
  console.log("\nLooking for WF-4 executions...");
  const r = await fetch(BASE + "/rest/executions?limit=20", {headers: {Cookie: cookie}});
  const data = await r.json();
  const execs = Array.isArray(data.data) ? data.data : [];
  console.log("Total executions:", execs.length);
  execs.forEach(e => {
    if (e.workflowName?.includes("WF-4")) {
      console.log("WF4 exec:", e.id, "status:", e.status);
    }
  });
}
main().catch(e => console.error(e));
