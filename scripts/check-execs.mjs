const BASE = "http://localhost:5678";
async function main() {
  const login = await fetch(BASE + "/rest/login", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({emailOrLdapLoginId: "mohamedafsar.arif@gmail.com", password: "TempPass123"})
  });
  const cookies = login.headers.getSetCookie?.() ?? [];
  const cookie = cookies.map(c => c.split(";")[0]).join("; ");

  const r = await fetch(BASE + "/rest/executions?limit=5", {headers: {Cookie: cookie}});
  const data = await r.json();
  console.log("Status:", r.status);
  console.log("Type:", typeof data);
  const execs = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
  console.log("Count:", execs.length);
  // Show first 2
  console.log("First 2:", JSON.stringify(execs.slice(0, 2).map(e => ({id: e.id, status: e.status, name: e.workflowName?.slice(0,40)})), null, 2));

  for (const e of execs.slice(0, 5)) {
    console.log("---");
    console.log("ID:", e.id, "Status:", e.status, "Name:", e.workflowName?.slice(0,50));

    if (e.status === "error" || e.status === "failed") {
      const d = await fetch(BASE + "/rest/executions/" + e.id, {headers: {Cookie: cookie}});
      const dd = await d.json();
      const exec = dd?.data || dd;
      // Find error in node results
      if (exec?.data?.resultData?.error) {
        console.log("Error:", exec.data.resultData.error.message?.slice(0,200));
      }
    }
  }
}
main().catch(e => console.error(e));
