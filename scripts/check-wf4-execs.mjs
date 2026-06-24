const BASE = "http://localhost:5678";
async function main() {
  const login = await fetch(BASE + "/rest/login", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({emailOrLdapLoginId: "mohamedafsar.arif@gmail.com", password: "TempPass123"})
  });
  const cookies = login.headers.getSetCookie?.() ?? [];
  const cookie = cookies.map(c => c.split(";")[0]).join("; ");

  const list = await (await fetch(BASE + "/rest/workflows", {headers: {Cookie: cookie}})).json();
  const wf4 = (list.data || []).find(w => w.name?.includes("WF-4"));
  if (!wf4) { console.log("No WF-4 found"); return; }
  console.log("WF-4:", wf4.id, "active:", wf4.active);

  const r = await fetch(BASE + "/rest/executions?workflowId=" + wf4.id + "&limit=5", {headers: {Cookie: cookie}});
  const data = await r.json();
  const execs = Array.isArray(data.data) ? data.data : [];
  console.log("Executions:", execs.length);
  for (const e of execs) {
    console.log(" -", e.id, "status:", e.status, "started:", e.startedAt);
    if (e.status === "error" || e.status === "failed") {
      const dr = await fetch(BASE + "/rest/executions/" + e.id, {headers: {Cookie: cookie}});
      const dd = await dr.json();
      const exec = dd?.data || dd;
      console.log("   Error:", JSON.stringify(exec?.data?.resultData?.error)?.slice(0,300));
    }
  }
}
main().catch(e => console.error(e));
