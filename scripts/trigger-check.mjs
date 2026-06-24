const BASE = "http://localhost:5678";
async function main() {
  const login = await fetch(BASE + "/rest/login", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({emailOrLdapLoginId: "mohamedafsar.arif@gmail.com", password: "TempPass123"})
  });
  const cookies = login.headers.getSetCookie?.() ?? [];
  const cookie = cookies.map(c => c.split(";")[0]).join("; ");

  console.log("Triggering webhook with long timeout...");
  const start = Date.now();
  try {
    const r = await fetch(BASE + "/webhook/start-cleanup", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({trigger: "manual"}),
      signal: AbortSignal.timeout(300000)
    });
    const elapsed = Date.now() - start;
    const text = await r.text();
    console.log("Status:", r.status, "Elapsed:", elapsed + "ms");
    console.log("Body:", text.slice(0,2000));
  } catch(e) {
    console.log("Error:", e.message, "Elapsed:", (Date.now()-start) + "ms");
  }

  // Check executions
  console.log("\nRecent executions...");
  const r2 = await fetch(BASE + "/rest/executions?limit=5", {headers: {Cookie: cookie}});
  const data = await r2.json();
  const execs = Array.isArray(data.data) ? data.data : [];
  console.log("Count:", execs.length);
  for (const e of execs) {
    console.log(" -", e.id, e.status, e.workflowName?.slice(0,40));
    if (e.status === "error") {
      const dr = await fetch(BASE + "/rest/executions/" + e.id, {headers: {Cookie: cookie}});
      const dd = await dr.json();
      console.log("   Error:", JSON.stringify(dd?.data || dd).slice(0,500));
    }
  }
}
main().catch(e => console.error(e));
