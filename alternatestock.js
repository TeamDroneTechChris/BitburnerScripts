let g_tixMode = false;

/** @param {NS} ns **/
export async function main(ns) {
	ns.disableLog('ALL');

	const player = ns.getPlayer();
	if (!player.hasWseAccount && !hasTixApiAccess) {
		ns.print('ERROR: You need a Wse account and Tix Api access to run this script.');
		ns.tprint('ERROR: You need a Wse account and Tix Api access to run this script.');
		return;
	}

	g_tixMode = player.has4SDataTixApi;

	if (g_tixMode) {
		ns.print('INFO: Starting stonks in 4S mode.');
		ns.tprint('INFO: Starting stonks in 4S mode.');
	}
	else {
		ns.print('WARN: Starting stonks in pre-4S mode.');
		ns.tprint('WARN: Starting stonks in pre-4S mode.');
	}

	if (ns.args[0] != 'sell') ns.tail();
	else {
		let procs = ns.ps();
		for (let proc of procs) {
			if (proc.filename == 'stonks.js' && proc.args.length == 0) {
				ns.tprint('WARN: Killing stonks.js!');
				ns.kill(proc.pid);
				break;
			}
		}
	}

	let marketLog = new Array();

	for (; ;) {
		// Update our market log
		TakeSnapshot(ns, marketLog);

		// Sort by forecast (for display purposes)
		let longs = marketLog.map(s => s).sort((a, b) => b.LastSnap().forecast - a.LastSnap().forecast);

		// Sell the stonks we have in our wallet that aren't worth keeping anymore
		SellStonks(ns, longs, ns.args[0] == 'sell');

		// If the user passed 'sell' as a parameter, we're dumping and killing the script
		if (ns.args[0] == 'sell') {
			//await UpdateHud(ns, undefined);
			return;
		}

		// Buy stocks that meet our criterion
		BuyStonks(ns, longs);

		// await UpdateHud(ns, total);

		// Display our last snapshot of the stocks data to the user
		ReportCurrentSnapshot(ns, longs);

		// Show profits and wallet
		let profit = 0;
		let cost = 0;
		for (let entry of marketLog) {
			cost += entry.LastSnap().GetPaid();
			profit += entry.LastSnap().GetProfit();
		}

		let totalStocks = cost + profit;
		let total = totalStocks + ns.getServerMoneyAvailable('home');

		ns.print('Stocks paid   : ' + ns.nFormat(cost, "$0.000a"));
		ns.print('Stocks profit : ' + ns.nFormat(profit, "$0.000a"));
		ns.print('Stocks total  : ' + ns.nFormat(totalStocks, "$0.000a"));
		ns.print('Total worth   : ' + ns.nFormat(total, "$0.000a"));

		await ns.asleep(6000);
	}
}

function SellStonks(ns, log, dump) {
	// *********************************
	// ***         LONGS
	// *********************************
	for (const stonk of log) {
		// If we don't have any shares, skip
		if (stonk.LastSnap().nbShares < 1) continue;

		// If our forecast is still positive, skip, unless we're dumping
		if (stonk.LastSnap().forecast >= 0.55 && !dump) continue;

		// If we don't have enough data, abort sales unless we're dumping
		if (!g_tixMode && stonk.snapshots.length < 12 && !dump) {
			ns.print('INFO: Would sell ' + stonk.LastSnap().nbShares + ' LONG shares of ' + stonk.sym + ' but we only have ' + stonk.snapshots.length + ' snapshots...');
			continue;
		}

		ns.print('WARN: Selling ' + stonk.LastSnap().nbShares + ' LONG shares of ' + stonk.sym);
		if (dump) ns.tprint('WARN: Selling ' + stonk.LastSnap().nbShares + ' LONG shares of ' + stonk.sym);
		ns.stock.sell(stonk.sym, stonk.LastSnap().nbShares);
	}

	// *********************************
	// ***         SHORTS
	// *********************************
	for (const stonk of log) {
		// If we don't have any shares, skip
		if (stonk.LastSnap().nbShorts < 1) continue;

		// If our forecast is still negative, skip, unless we're dumping
		if (stonk.LastSnap().forecast <= 0.45 && !dump) continue;

		// If we don't have enough data, abort sales unless we're dumping
		if (!g_tixMode && stonk.snapshots.length < 12 && !dump) {
			ns.print('INFO: Would sell ' + stonk.LastSnap().nbShorts + ' SHORT shares of ' + stonk.sym + ' but we only have ' + stonk.snapshots.length + ' snapshots...');
			continue;
		}

		ns.print('WARN: Selling ' + stonk.LastSnap().nbShorts + ' SHORT shares of ' + stonk.sym);
		if (dump) ns.tprint('WARN: Selling ' + stonk.LastSnap().nbShorts + ' SHORT shares of ' + stonk.sym);
		ns.stock.sellShort(stonk.sym, stonk.LastSnap().nbShorts);
	}
}

function BuyStonks(ns, log) {
	// If you're buying Long, you want Ask price. Long stocks sell for Bid price.
	// If you're buying Short, you want Bid price. Short stocks sell for Ask price.

	// *********************************
	// ***         LONGS
	// *********************************
	let longs = log.map(s => s).filter(p => p.LastSnap().forecast > 0.6).sort((a, b) => b.LastSnap().forecast - a.LastSnap().forecast);

	for (const stonk of longs) {
		// Check if we have enough pre-S4 data to make a decision
		if (!g_tixMode && stonk.snapshots.length < 12)
			continue;

		// We're only buying at/over 0.6 forecast (anything over 0.5 is trending up)
		if (stonk.LastSnap().forecast < 0.6) continue;

		// Get the player's money (minus 50m for comission and a little buffer)
		let cash = (ns.getServerMoneyAvailable('home') - 50_000_000);
		// We don't want to buy small amounts to avoid burning ourselves on transaction costs
		if (cash < 25_000_000) return;

		// Count how many shares we can buy
		let maxShares = ns.stock.getMaxShares(stonk.sym) - stonk.LastSnap().nbShares - stonk.LastSnap().nbShorts;
		// Clamp to the amount of cash we have available total
		maxShares = Math.min(maxShares, Math.floor(cash / stonk.LastSnap().askPrice));

		// We broke!
		if (maxShares == 0) continue;

		// Buy some stocks!
		ns.print('INFO: Buying ' + maxShares + ' LONG shares of ' + stonk.sym + ' at price ' + ns.nFormat(maxShares * stonk.LastSnap().askPrice, "$0.000a"));
		ns.enableLog('stock.buy');
		ns.stock.buy(stonk.sym, maxShares);
	}


	// *********************************
	// ***         SHORTS
	// *********************************
	let shorts = log.map(s => s).filter(p => p.LastSnap().forecast < 0.4).sort((a, b) => a.LastSnap().forecast - b.LastSnap().forecast);

	for (const stonk of shorts) {
		// Check if we have enough pre-S4 data to make a decision
		if (!g_tixMode && stonk.snapshots.length < 12)
			continue;

		// We're only buying at/under 0.4 forecast
		if (stonk.LastSnap().forecast > 0.4) continue;

		// Get the player's money (minus 500k for comission and a little buffer)
		let cash = (ns.getServerMoneyAvailable('home') - 50_000_000);
		// We don't want to buy small amounts to avoid burning ourselves on transaction costs
		if (cash < 25_000_000) return;

		// Count how many shares we can buy
		let maxShares = ns.stock.getMaxShares(stonk.sym) - stonk.LastSnap().nbShares - stonk.LastSnap().nbShorts;
		// Clamp to the amount of cash we have available total
		maxShares = Math.min(maxShares, Math.floor(cash / stonk.LastSnap().bidPrice));

		// We broke!
		if (maxShares == 0) continue;

		// Buy some stocks!
		ns.print('INFO: Buying ' + maxShares + ' SHORT shares of ' + stonk.sym + ' at price ' + ns.nFormat(maxShares * stonk.LastSnap().bidPrice, "$0.000a"));
		ns.stock.short(stonk.sym, maxShares);
	}
}

function TakeSnapshot(ns, marketLog) {
	const symbols = ns.stock.getSymbols();
	for (const sym of symbols) {
		let entry = marketLog.find(p => p.sym == sym);
		if (entry == undefined) {
			entry = new Stonk(ns, sym);
			marketLog.push(entry);
		}
		entry.Snap();
	}
}

function ReportCurrentSnapshot(ns, marketLog) {
	let header = '│  ' +
		'SYM'.padEnd(6) +
		'Count'.padEnd(8) +
		'Forecast'.padStart(10) +
		'  │';

	ns.print('┌' + ''.padEnd(header.length - 2, '─') + '┐');
	ns.print(header);
	ns.print('├' + ''.padEnd(header.length - 2, '─') + '┤');

	for (const entry of marketLog) {
		let snap = entry.snapshots[entry.snapshots.length - 1];
		let sym = entry.sym;
		if (snap.shares > 0) sym = '<' + sym + '>';
		let report =
			sym.padEnd(6) +
			entry.snapshots.length.toString().padEnd(8) +
			snap.forecast.toFixed(4).padStart(10) +
			'  │';

		ns.print('│  ' + report);
	}

	ns.print('└' + ''.padEnd(header.length - 2, '─') + '┘');
}

// async function UpdateHud(ns, totalWorth) {
// 	const doc = eval('document');
// 	const hook0 = doc.getElementById('overview-extra-hook-0');
// 	const hook1 = doc.getElementById('overview-extra-hook-1');

// 	try {
// 		const headers = []
// 		const values = [];

// 		if (totalWorth == undefined) {
// 			hook0.innerText = '';
// 			hook1.innerText = '';
// 			return;
// 		}

// 		const karma = ns.heart.break();
// 		if (karma > -54000) {
// 			headers.push("Total Karma: ");
// 			values.push('   ' + ns.nFormat(karma, '0,0'));
// 		}

// 		headers.push('Total worth: ');
// 		values.push(ns.nFormat(totalWorth, "$0.000a"));

// 		hook0.innerText = headers.join(" \n");
// 		hook1.innerText = values.join("\n");
// 	} catch (err) {
// 		ns.print("ERROR: Update Skipped: " + String(err));
// 	}
// }

export class Stonk {
	constructor(ns, name) {
		this.ns = ns;

		this.sym = name;
		this.snapshots = [];
	}

	Snap() {
		// Add the snapshot to the list
		this.snapshots.push(new Snapshot(this.ns, this.sym, this));

		// We keep 15 snapshots maximim total
		if (this.snapshots.length > 12) {
			this.snapshots.shift();
		}
	}

	LastSnap() {
		return this.snapshots.slice(-1).pop();
	}
}

export class Snapshot {
	constructor(ns, name, stonk) {
		// Obtain prices and other stock metrics
		this.askPrice = ns.stock.getAskPrice(name);
		this.bidPrice = ns.stock.getBidPrice(name);
		this.price = ns.stock.getPrice(name);
		this.maxShares = ns.stock.getMaxShares(name);

		// Get current position on longs and shorts
		const [shares, avgPx, sharesShort, avgPxShort] = ns.stock.getPosition(name);
		this.nbShares = shares;
		this.avgPrice = avgPx;
		this.nbShorts = sharesShort;
		this.avgShortPrice = avgPxShort;

		// Get volatility and forecast if available
		if (g_tixMode) {
			this.forecast = ns.stock.getForecast(name);
		}
		else {
			// Recound the ups and downs for pre-4S forecast estimation
			let nbDown = 0;
			let nbUp = 0;
			for (let i = 1; i < stonk.snapshots.length; i++) {
				let prev = stonk.snapshots[i - 1];
				let cur = stonk.snapshots[i];

				if (prev.askPrice < cur.askPrice) nbUp++;
				if (prev.askPrice > cur.askPrice) nbDown++;
			}

			// We simulate a forecast based on the last 12- operations
			if (stonk.snapshots.length == 12)
				this.forecast = nbUp / 12.0;
			else
				this.forecast = 0.5;
		}
	}

	GetPaid() {
		let longCost = this.nbShares * this.avgPrice;
		let shortCost = this.nbShorts * this.avgShortPrice;
		return longCost + shortCost;
	}

	GetProfit() {
		// Short stocks sell for Ask price.
		// Long stocks sell for Bid price.
		let longProfit = this.nbShares * this.bidPrice - this.nbShares * this.avgPrice;
		let shortProfit = this.nbShorts * this.avgShortPrice - this.nbShorts * this.askPrice;
		return longProfit + shortProfit;
	}
}
