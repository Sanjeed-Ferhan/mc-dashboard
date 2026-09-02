import express from "express";
import cors from "cors";
import sql from "mssql";

const dbConfig = {
  server: process.env.MSSQL_SERVER || "203.202.241.211",
  port: parseInt(process.env.MSSQL_PORT || "1433"),
  user: process.env.MSSQL_USER || "mcp_user",
  password: process.env.MSSQL_PASSWORD || "iAOS@35o997",
  database: process.env.MSSQL_DATABASE || "DWH",
  options: { encrypt: process.env.MSSQL_ENCRYPT === "true", trustServerCertificate: true },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

let pool = null;
async function getPool() {
  if (!pool) pool = await sql.connect(dbConfig);
  return pool;
}

const app = express();
app.use(cors());
app.use(express.static("public"));

// meta: business units + available years
app.get("/api/meta", async (req, res) => {
  try {
    const p = await getPool();
    const r = await p.request().query(`
      SELECT DISTINCT bu.strBusinessUnitCode AS sbu, bu.strBusinessUnitName AS bu_name
      FROM DWH.mes.tblOeeProdWasteHeaderArc h
      LEFT JOIN DataMart.dbo.tblBusinessUnit bu ON bu.intBusinessUnitId = h.intBusinessUnitId
      WHERE h.isActive = 1 AND bu.strBusinessUnitCode IS NOT NULL
      ORDER BY sbu
    `);
    const y = await p.request().query(`
      SELECT DISTINCT YEAR(dteProductionDate) AS yr FROM DWH.mes.tblOeeProdWasteHeaderArc WHERE isActive = 1 ORDER BY yr
    `);
    res.json({ sbus: r.recordset, years: y.recordset.map(x => x.yr) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// summary aggregated by MC (+ SBU/plant/shopfloor/uom)
app.get("/api/oee", async (req, res) => {
  try {
    const { from, to, sbu } = req.query;
    const p = await getPool();
    const reqQ = p.request();
    let where = `h.isActive = 1 AND h.dteProductionDate >= @from AND h.dteProductionDate <= @to`;
    reqQ.input('from', sql.Date, from || '2026-08-01');
    reqQ.input('to', sql.Date, to || '2026-08-31');
    if (sbu) { where += ` AND bu.strBusinessUnitCode = @sbu`; reqQ.input('sbu', sql.NVarChar, sbu); }

    const q = `
      SELECT
        bu.strBusinessUnitCode AS sbu,
        bu.strBusinessUnitName AS bu_name,
        h.intBusinessUnitId AS bu_id,
        h.strPlantName, h.strShopFloorName, h.strMachineName AS mc, h.strUOMName AS uom,
        COUNT(*) AS shift_cnt,
        SUM(h.numShiftDurationMinute) AS shift_min,
        SUM(h.numAvailableMinute) AS avail_min,
        SUM(h.numLoadingMinute) AS load_min,
        SUM(h.numPlannedDowntimeMin) AS planned_dt_min,
        SUM(h.numNptLossTimeInMinutes) AS npt_loss_min_hdr,
        SUM(h.numShiftTargetQuantity) AS target_qty,
        SUM(h.numCapacityPerHr * h.numAvailableMinute / 60.0) AS capacity_qty,
        SUM(h.numCapacityPerHr * h.numShiftDurationMinute / 60.0) AS capacity_full,
        SUM(h.numActualOutputQuantity) AS actual_qty,
        SUM(h.numGoodOutputQuantity) AS good_qty,
        SUM(h.numWastageTargetQuantity) AS wastage_tgt,
        SUM(h.numStandardRPM * h.numLoadingMinute) AS std_rpm_w,
        SUM(h.numActualRPM * h.numLoadingMinute) AS act_rpm_w,
        SUM(h.numActualOutputQuantity / NULLIF(h.numLoadingMinute,0) * 60.0) AS actual_speed_qty_hr,
        SUM(h.numCapacityPerHr * h.numLoadingMinute / 60.0) AS ideal_out,
        SUM(h.numCapacityPerHr) AS cap_per_hr,
        SUM(h.numStandardRPM) AS std_rpm,
        SUM(h.numActualRPM) AS act_rpm
      FROM DWH.mes.tblOeeProdWasteHeaderArc h
      LEFT JOIN DataMart.dbo.tblBusinessUnit bu ON bu.intBusinessUnitId = h.intBusinessUnitId
      WHERE ${where}
      GROUP BY bu.strBusinessUnitCode, bu.strBusinessUnitName, h.intBusinessUnitId,
        h.strPlantName, h.strShopFloorName, h.strMachineName, h.strUOMName
      ORDER BY sbu, h.strPlantName, h.strShopFloorName, h.strMachineName
    `;
    const r = await reqQ.query(q);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// NPT breakdown + unplanned downtime by MC for MTTR/MTBF + unplanned minutes
app.get("/api/npt", async (req, res) => {
  try {
    const { from, to, sbu } = req.query;
    const p = await getPool();
    const reqQ = p.request();
    let where = `h.isActive = 1 AND r.isActive = 1 AND CAST(h.dteLossTimeDate AS DATE) >= @from AND CAST(h.dteLossTimeDate AS DATE) <= @to`;
    reqQ.input('from', sql.Date, from || '2026-08-01');
    reqQ.input('to', sql.Date, to || '2026-08-31');
    if (sbu) { where += ` AND bu.strBusinessUnitCode = @sbu`; reqQ.input('sbu', sql.NVarChar, sbu); }

    const q = `
      SELECT
        bu.strBusinessUnitCode AS sbu,
        h.intBusinessUnitId AS bu_id,
        h.strPlantName, h.strShopFloorName, h.strWrokCenterName AS mc,
        SUM(CASE WHEN r.strCategoryName IN ('Mechanical','Electrical') THEN r.intLossTimeInMinutes ELSE 0 END) AS breakdown_min,
        SUM(CASE WHEN r.strCategoryName IN ('Mechanical','Electrical') THEN 1 ELSE 0 END) AS breakdown_cnt,
        SUM(r.intLossTimeInMinutes) AS unplanned_min,
        COUNT(*) AS npt_cnt
      FROM DWH.mes.tblNPTRowArc r
      INNER JOIN DWH.mes.tblNPTHeaderArc h ON h.intNPTId = r.intNPTId
      LEFT JOIN DataMart.dbo.tblBusinessUnit bu ON bu.intBusinessUnitId = h.intBusinessUnitId
      WHERE ${where}
      GROUP BY bu.strBusinessUnitCode, h.intBusinessUnitId,
        h.strPlantName, h.strShopFloorName, h.strWrokCenterName
    `;
    const r = await reqQ.query(q);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// wastage rows detail by MC
app.get("/api/waste", async (req, res) => {
  try {
    const { from, to, sbu } = req.query;
    const p = await getPool();
    const reqQ = p.request();
    let where = `h.isActive = 1 AND w.isActive = 1 AND h.dteProductionDate >= @from AND h.dteProductionDate <= @to`;
    reqQ.input('from', sql.Date, from || '2026-08-01');
    reqQ.input('to', sql.Date, to || '2026-08-31');
    if (sbu) { where += ` AND bu.strBusinessUnitCode = @sbu`; reqQ.input('sbu', sql.NVarChar, sbu); }
    const q = `
      SELECT bu.strBusinessUnitCode AS sbu, h.intBusinessUnitId AS bu_id,
        h.strPlantName, h.strShopFloorName, h.strMachineName AS mc,
        w.strWastedCategoryName AS waste_cat, w.strWasteReason AS reason,
        SUM(w.numWasteQuantity) AS waste_qty
      FROM DWH.mes.tblOeeProdWasteRowArc w
      INNER JOIN DWH.mes.tblOeeProdWasteHeaderArc h ON h.intOeeProdWasteHeaderId = w.intOeeProdWasteHeaderId
      LEFT JOIN DataMart.dbo.tblBusinessUnit bu ON bu.intBusinessUnitId = h.intBusinessUnitId
      WHERE ${where}
      GROUP BY bu.strBusinessUnitCode, h.intBusinessUnitId,
        h.strPlantName, h.strShopFloorName, h.strMachineName, w.strWastedCategoryName, w.strWasteReason
    `;
    const r = await reqQ.query(q);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => console.log(`MC Dashboard on http://localhost:${PORT}`));
