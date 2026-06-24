const BASE = "http://localhost:5678";
async function main() {
  const login = await fetch(BASE + "/rest/login", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({emailOrLdapLoginId: "mohamedafsar.arif@gmail.com", password: "TempPass123"})
  });
  const cookies = login.headers.getSetCookie?.() ?? [];
  const cookie = cookies.map(c => c.split(";")[0]).join("; ");

  const r = await fetch(BASE + "/rest/credentials", {headers: {Cookie: cookie}});
  const data = await r.json();
  const creds = data.data || data;
  console.log("Credentials count:", creds.length);
  if (Array.isArray(creds)) {
    creds.forEach(c => console.log("id:", c.id, "| name:", c.name, "| type:", c.type));
  }
}
main().catch(e => console.error(e.message));
