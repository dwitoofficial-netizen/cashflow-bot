const { google } = require("googleapis");

// =====================
// AUTH SETUP
// =====================
const auth = new google.auth.GoogleAuth({
    keyFile: "service-account.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// =====================
// APPEND ROW
// =====================
async function appendRow(sheet, values) {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${sheet}!A:G`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
            values: [values],
        },
    });
}

// =====================
// GET ACTIVE CYCLE
// =====================
async function getActiveCycle(userId) {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: "Cycles!A:G",
    });

    const rows = res.data.values || [];

    for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];

        const cycleId = row[0];
        const endDate = row[2];
        const rowUserId = row[6];

        // 🔥 FILTER PER USER
        if (rowUserId == userId && cycleId && (!endDate || endDate === "")) {
            return {
                id: row[0],
                startDate: row[1],
                salary: row[3],
                incomeTotal: row[4],
                expenseTotal: row[5],
                user: row[6],
            };
        }
    }

    return null;
}

async function updateCycleTotals(cycleId, type, amount) {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: "Cycles!A:G",
    });

    const rows = res.data.values || [];

    for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === cycleId) {
            let income = Number(rows[i][4] || 0);
            let expense = Number(rows[i][5] || 0);

            if (type === "INCOME") {
                income += Number(amount);
            }

            if (type === "EXPENSE") {
                expense += Number(amount);
            }

            await sheets.spreadsheets.values.update({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: `Cycles!E${i + 1}:F${i + 1}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [[income, expense]],
                },
            });

            break;
        }
    }
}

async function setCategoryBudget(userId, pairs) {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const weekStart = new Date().toISOString().split("T")[0];

    const values = [];

    for (let i = 0; i < pairs.length; i += 2) {
        const category = pairs[i];
        const budget = Number(pairs[i + 1]);

        values.push([
            userId,
            weekStart,
            category,
            budget,
            0,
            budget,
        ]);
    }

    await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: "CategoryBudget!A:F",
        valueInputOption: "USER_ENTERED",
        requestBody: {
            values,
        },
    });
}

async function getCategoryBudget(userId, category) {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: "CategoryBudget!A:F",
    });

    const rows = res.data.values || [];

    for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];

        if (row[0] == userId && row[2] == category) {
            return {
                budget: Number(row[3]),
                used: Number(row[4] || 0),
                remaining: Number(row[5] || row[3]),
            };
        }
    }

    return null;
}

async function getTodayExpense(userId) {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: "Transactions!A:G",
    });

    const rows = res.data.values || [];

    const today = new Date().toISOString().split("T")[0];

    let total = 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];

        const timestamp = row[0];
        const type = row[1];
        const amount = Number(row[2]);
        const rowUser = row[6];

        if (
            rowUser == userId &&
            type === "EXPENSE" &&
            timestamp &&
            timestamp.startsWith(today)
        ) {
            total += amount;
        }
    }

    return total;
}

async function updateCategoryBudget(userId, category, amount) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: "CategoryBudget!A:F",
  });

  const rows = res.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const rowUser = row[0];
    const rowCategory = row[2];

    if (rowUser == userId && rowCategory == category) {
      let budget = Number(row[3] || 0);
      let used = Number(row[4] || 0);
      let remaining = Number(row[5] || budget);

      used += Number(amount);
      remaining = budget - used;

      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `CategoryBudget!D${i + 1}:F${i + 1}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[budget, used, remaining]],
        },
      });

      return {
        budget,
        used,
        remaining,
      };
    }
  }

  return null;
}

async function getAllCategoryBudget(userId) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: "CategoryBudget!A:F",
  });

  const rows = res.data.values || [];

  const result = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    if (row[0] == userId) {
      result.push({
        category: row[2],
        budget: Number(row[3]),
        used: Number(row[4] || 0),
        remaining: Number(row[5] || 0),
      });
    }
  }

  return result;
}

// =====================
// EXPORTS (WAJIB SATU DI AKHIR)
// =====================
module.exports = {
  appendRow,
  getActiveCycle,
  updateCycleTotals,
  setCategoryBudget,
  getCategoryBudget,
  getTodayExpense,
  updateCategoryBudget,
  getAllCategoryBudget,
};