require("dotenv").config();

const cron = require("node-cron");
const { Telegraf } = require("telegraf");
const { google } = require("googleapis");

const {
  appendRow,
  getActiveCycle,
  updateCycleTotals,
  setCategoryBudget,
  updateCategoryBudget,
  getAllCategoryBudget,
  getAllUsers,
} = require("./sheets");

// =====================
// INIT
// =====================
if (!process.env.BOT_TOKEN) {
  throw new Error("BOT_TOKEN missing");
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// =====================
// FORMAT MONEY
// =====================
function formatRupiah(n) {
  return "Rp " + Number(n || 0).toLocaleString("id-ID");
}

// =====================
// START
// =====================
bot.start((ctx) => {
  ctx.reply(
`Cashflow bot aktif

Commands:
- /salary 8000000
- /income 500000 bonus
- /expense 50000 makan nasi
- /budget (set budget)
- /infobudget (summary)`
  );
});

// =====================
// HELP
// =====================
bot.hears(/^\/help$/, (ctx) => {
  ctx.reply(
`FORMAT CASHFLOW BOT

SALARY:
salary 8000000

INCOME:
income 500000 bonus

EXPENSE:
expense 50000 makan nasi goreng

BUDGET SET:
- /plan (template only)
- /budget (save budget)
- /infobudget (summary)`
  );
});

// =====================
// SALARY
// =====================
bot.hears(/^\/salary (.+)/, async (ctx) => {
  try {
    const amount = Number(ctx.message.text.split(" ")[1]);
    const cycleId = "cycle_" + Date.now();

    await appendRow("Cycles", [
      cycleId,
      new Date().toISOString(),
      "",
      amount,
      0,
      0,
      ctx.from.id,
    ]);

    ctx.reply(`Cycle dibuat\nID: ${cycleId}`);
  } catch (err) {
    console.error(err);
    ctx.reply("Error salary");
  }
});

// =====================
// INCOME
// =====================
bot.hears(/^\/income (.+)/, async (ctx) => {
  try {
    const parts = ctx.message.text.split(" ");
    const amount = Number(parts[1]);
    const desc = parts.slice(2).join(" ");

    const cycle = await getActiveCycle(ctx.from.id);
    const cycleId = cycle?.id || "NO_CYCLE";

    await appendRow("Transactions", [
      new Date().toISOString(),
      "INCOME",
      amount,
      "-",
      desc,
      cycleId,
      ctx.from.id,
    ]);

    if (cycle) await updateCycleTotals(cycle.id, "INCOME", amount);

    ctx.reply(`Income: ${formatRupiah(amount)}`);
  } catch (err) {
    console.error(err);
    ctx.reply("Error income");
  }
});

// =====================
// SMART ALERT
// =====================
async function smartAlert(userId, category, amount) {
  const budgets = await getAllCategoryBudget(userId);
  const target = budgets.find(b => b.category === category);

  if (!target) return [];

  const usedAfter = target.used + amount;
  const alerts = [];

  if (usedAfter > target.budget) {
    alerts.push("OVER BUDGET");
  }

  if (usedAfter >= target.budget * 0.8) {
    alerts.push("Sudah 80% budget");
  }

  return alerts;
}

// =====================
// EXPENSE
// =====================
bot.hears(/^\/expense (.+)/, async (ctx) => {
  try {
    const parts = ctx.message.text.trim().split(/\s+/);

    const amount = Number(parts[1]);
    const category = parts[2]?.toLowerCase();
    const desc = parts.slice(3).join(" ");

    if (!amount || isNaN(amount)) {
      return ctx.reply("Amount tidak valid");
    }

    if (!category) {
      return ctx.reply("Category wajib diisi");
    }

    const cycle = await getActiveCycle(ctx.from.id);
    const cycleId = cycle?.id || "NO_CYCLE";

    await appendRow("Transactions", [
      new Date().toISOString(),
      "EXPENSE",
      amount,
      category,
      desc || "-",
      cycleId,
      ctx.from.id,
    ]);

    if (cycle) await updateCycleTotals(cycle.id, "EXPENSE", amount);

    await updateCategoryBudget(ctx.from.id, category, amount);

    const report = await buildBudgetReport(ctx.from.id);
    const alerts = await smartAlert(ctx.from.id, category, amount);

    let alertText = "";
    if (alerts.length) {
      alertText =
        "\nALERT:\n" +
        alerts.map(a => "- " + a).join("\n");
    }

    ctx.reply(
`Expense tercatat

Jumlah: ${formatRupiah(amount)}
Kategori: ${category}
Deskripsi: ${desc || "-"}

${report}
${alertText}`
    );

  } catch (err) {
    console.error(err);
    ctx.reply("Error expense");
  }
});

// =====================
// /PLAN (TEMPLATE ONLY)
// =====================
bot.hears(/^\/plan$/, (ctx) => {
  ctx.reply(
`Template Budget Input:

budget
makan: 200000
transport: 800000
hiburan: 100000`
  );
});

// =====================
// /BUDGET (SAVE)
// =====================
bot.hears(/^\/budget([\s\S]*)/, async (ctx) => {
  try {
    let text = ctx.message.text.replace("/budget", "").trim();

    let pairs = [];

    if (!text.includes(":") && text.length > 0) {
      const parts = text.split(/\s+/);
      if (parts.length % 2 !== 0) {
        return ctx.reply("Format salah");
      }
      pairs = parts;
    } else {
      const lines = text.split("\n").filter(Boolean);
      for (const l of lines) {
        const [k, v] = l.split(":");
        if (k && v) {
          pairs.push(k.trim());
          pairs.push(v.trim());
        }
      }
    }

    if (!pairs.length) {
      return ctx.reply("Tidak ada data budget");
    }

    await setCategoryBudget(ctx.from.id, pairs);

    ctx.reply("Budget tersimpan");
  } catch (err) {
    console.error(err);
    ctx.reply("Error budget");
  }
});

// =====================
// ✅ FIXED BUDGET INFO (INI YANG DIPERBAIKI)
// =====================
async function buildBudgetReport(userId) {
  const budgets = await getAllCategoryBudget(userId);

  if (!budgets || budgets.length === 0) {
    return "Belum ada budget";
  }

  let msg = "BUDGET SUMMARY\n\n";

  for (const b of budgets) {
    const budget = Number(b.budget || 0);
    const used = Number(b.used || 0);
    const remaining = Number(b.remaining || (budget - used));

    let status = "AMAN";
    if (remaining < 0) status = "OVER";
    else if (remaining < budget * 0.2) status = "LOW";

    msg +=
`- ${b.category}
  Budget: ${formatRupiah(budget)}
  Used  : ${formatRupiah(used)}
  Sisa  : ${formatRupiah(remaining)}
  Status: ${status}

`;
  }

  return msg;
}

// =====================
// /infobudget
// =====================
bot.hears(/^\/infobudget$/, async (ctx) => {
  const report = await buildBudgetReport(ctx.from.id);
  ctx.reply(report);
});

// =====================
// WEEKLY REPORT
// =====================
async function getLast7DaysTransactions(userId) {
  const auth = new google.auth.GoogleAuth({
    keyFile: "service-account.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: "Transactions!A:G",
  });

  const rows = res.data.values || [];

  const now = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(now.getDate() - 7);

  return rows.slice(1).filter(r => {
    const d = new Date(r[0]);
    return r[6] == userId && d >= weekAgo;
  }).map(r => ({
    type: r[1],
    amount: Number(r[2]),
    category: r[3],
  }));
}

async function buildWeeklyReport(userId) {
  const tx = await getLast7DaysTransactions(userId);

  if (!tx.length) return "Tidak ada transaksi minggu ini";

  let income = 0;
  let expense = 0;
  const map = {};

  for (const t of tx) {
    if (t.type === "INCOME") income += t.amount;
    if (t.type === "EXPENSE") {
      expense += t.amount;
      map[t.category] = (map[t.category] || 0) + t.amount;
    }
  }

  const net = income - expense;

  let msg =
`WEEKLY REPORT

Income : ${formatRupiah(income)}
Expense: ${formatRupiah(expense)}
Net    : ${formatRupiah(net)}

Breakdown:
`;

  for (const [k, v] of Object.entries(map)) {
    msg += `- ${k}: ${formatRupiah(v)}\n`;
  }

  msg += net >= 0 ? "\nStatus: SEHAT" : "\nStatus: DEFISIT";

  return msg;
}

// =====================
// CRON
// =====================
cron.schedule("0 13 * * 0", async () => {
  const users = await getAllUsers();

  for (const userId of users) {
    const report = await buildWeeklyReport(userId);

    const reminder =
`WEEKLY PLANNING

Set budget minggu depan:

budget
makan: 400000
transport: 300000
hiburan: 100000`;

    await bot.telegram.sendMessage(userId, report + "\n\n" + reminder);
  }
});

// =====================
// RUN
// =====================
bot.launch();

console.log("Bot running clean final version");