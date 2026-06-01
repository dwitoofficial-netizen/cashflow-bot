let activeCycle = null;

function startCycle(amount, user) {
  activeCycle = {
    id: "cycle_" + new Date().toISOString(),
    salary: amount,
    startDate: new Date(),
    user: user
  };

  return activeCycle;
}

function getCycle() {
  return activeCycle;
}

function endCycle() {
  activeCycle = null;
}

module.exports = { startCycle, getCycle, endCycle };