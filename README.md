# MC OEE Production Summary Dashboard

Live MC-level (machine-level) OEE production summary dashboard for all Akij SBUs, queried directly from the DWH SQL Server. Displays machine-level Capacity, Target, Production, Achieve %, Capacity Utilization, Quality/Waste, OEE %, NPT %, Speed, Downtime, and Reliability (MTBF/MTTR), with slicers for Year, Month, From/To Date, and Business Unit.

- **Data source:** Akij DWH (`DWH.mes.tblOeeProdWasteHeaderArc` + `DWH.mes.tblNPTHeaderArc` / `tblNPTRowArc`)
- **Backend:** Node.js + Express + `mssql` (serverless entry for Vercel, plus a local dev server)
- **Frontend:** Single-page HTML/JS dashboard

---

## Dashboard Columns

| Group | Columns |
|---|---|
| Identity | SBU, MC, UOM |
| Production Plan | Capacity, Target, Production, Achieve %, Capacity Utilization |
| Quality & Waste | Good Production, Yield %, Wastage TGT, Actual Wastage, Wastage % |
| Efficiency | OEE %, NPT % |
| Speed | TGT Speed, Actual Speed, Speed Gap |
| Downtime | Planned DT (min), Unplanned DT (min) |
| Reliability | MTBF (hrs), MTTR (hrs) |

---

## Metric Formulas

| Metric | Formula |
|---|---|
| Capacity | Σ (Capacity/hr × ShiftDur / 60) |
| Target | Σ (Capacity/hr × AvailMin / 60) |
| Production | Σ Actual Output Quantity |
| Achieve % | Actual ÷ Target |
| Capacity Utilization % | Actual ÷ Capacity |
| Good Production | Σ Good Output Quantity |
| Yield % | Good ÷ Actual |
| Wastage TGT | Σ Wastage Target Quantity |
| Actual Wastage | Actual − Good |
| Wastage % | (Actual − Good) ÷ Actual |
| Availability | (AvailMin − Unplanned) ÷ AvailMin |
| Performance | Actual ÷ Target |
| OEE % | Availability × Performance × Yield |
| NPT % | Unplanned ÷ AvailMin |
| TGT Speed | Load-weighted avg of Standard RPM |
| Actual Speed | Load-weighted avg of Actual RPM |
| Speed Gap | TGT Speed − Actual Speed |
| Planned DT | Σ Planned Downtime minutes |
| Unplanned DT | Σ NPT loss minutes |
| MTBF | (Actual Runtime minutes ÷ 60) ÷ Mech+Elec Breakdown Events |
| MTTR | (Mech+Elec Breakdown minutes ÷ 60) ÷ Breakdown Events |

> Unplanned downtime draws from the NPT log (all categories). MTBF/MTTR use **only Mechanical & Electrical** breakdown events.

---

## Availability of data

The DWH tracks production (OEE) and NPT downtime. Some SBUs / months may have no records — those rows simply don't appear.

---

## Local Development

```bash
cd mc-dashboard
npm install
npm start          # starts server.mjs on http://localhost:3100
```

Environment overrides (optional): `MSSQL_SERVER`, `MSSQL_PORT`, `MSSQL_USER`, `MSSQL_PASSWORD`, `MSSQL_DATABASE`, `MSSQL_ENCRYPT`.

---

## Deploy to Vercel

The repo includes a serverless entry (`api/index.mjs`) and `vercel.json`.

```bash
npm i -g vercel
vercel login
vercel --prod --yes
```

Set environment variables in the Vercel project (Settings → Environment Variables):

| Variable | Value |
|---|---|
| `MSSQL_SERVER` | `203.202.241.211` |
| `MSSQL_PORT` | `1433` |
| `MSSQL_USER` | `mcp_user` |
| `MSSQL_PASSWORD` | *(your password)* |
| `MSSQL_DATABASE` | `DWH` |
| `MSSQL_ENCRYPT` | `false` |

> **Important:** Vercel Functions use dynamic outbound IPs. To reach a firewall-protected SQL Server from Vercel, enable **Static IPs** (Pro/Enterprise) and allowlist the assigned egress IPs on the database firewall, or deploy the API on a host inside your network.

---

## Public sharing from a local machine (tunnel)

Since the local machine can reach the DWH directly, you can expose the dashboard publicly with a Cloudflare quick tunnel (no account needed):

```bash
cloudflared tunnel --url http://localhost:3100
```

This prints a public `https://<random>.trycloudflare.com` URL. The machine must stay running; the URL changes on restart.

---

## File Structure

```
mc-dashboard/
├── api/index.mjs      # Serverless Express entry for Vercel (serves static + /api)
├── public/index.html  # Dashboard UI (single page)
├── server.mjs         # Local dev server (Express)
├── vercel.json        # Vercel build/routes config
├── package.json
└── .gitignore
```

---

## License

MIT
