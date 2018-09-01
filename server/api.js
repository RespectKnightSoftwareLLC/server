// Server for "REST" API requests
const component = "api";
const acceptedClients = ["dotnet", "js"];
const version = "0.0.1";

/*
 * See documentation at
 * https://github.com/RKOrderSoft/server/wiki/API-reference
 * for full API use instructions
 */

module.exports = function (app, db, auth, sessions, orders, sh) {
	// /api/test
	//   Test API, returns version info
	//   Used to identify OrderSoft server
	app.post("/api/test", async (req, res) => {
		sh.log("POST /api/test/ from " + req.ip, component, true);
		
		// Check client name
		if (!checkAcceptedClient(req, res)) return;

		var resBody = {};

		if (req.body.test === true) {
			res.status(200);
		} else {
			res.status(400);
			resBody.reason = "malformed request (was a 'test': true provided?)";
		}

		return res.json(buildResponse(resBody));
	});

	// /api/login
	//   Used for authentication
	//   Responds with a session id
	app.post("/api/login", async (req, res) => {
		sh.log("POST /api/login/ from " + req.ip, component, true);

		// Check client name
		if (!checkAcceptedClient(req, res)) return;

		var resBody = {};

		if (!(req.body.password && req.body.username)) {
			res.status(400);
			resBody.reason = "Username or password field empty";
		} else {
			// fields are present
			try {
				var userRow = await auth.authenticate(req.body.username, req.body.password);
				
				var newSessionId = await sessions.issueSessionId(req.ip.toString(), userRow);

				res.status(200);
				resBody.sessionId = newSessionId;
				resBody.accessLevel = userRow.accessLevel;
			} catch (err) {
				res.status(401);
				resBody.reason = err.toString();
			}
		}

		return res.json(buildResponse(resBody));
	});

	// /api/getorder
	//   Used to retrieve order information
	app.post("/api/getorder", async (req, res) => {
		sh.log("POST /api/getorder/ from " + req.ip, component, true);

		// Check client name
		if (!checkAcceptedClient(req, res)) return;

		// Check access level
		if (!(await checkAccessLevel(sessions, req, res, 0))) return;

		var resBody = {};

		if (!(req.body.orderId) && !(req.body.tableNumber)) {
			// malformed request
			res.status(400);
			resBody.reason = "Either orderId or tableNumber must be provided.";
		} else {
			// Retrieve order details
			var orderPromise;

			if (req.body.orderId) {
				// Use order ID
				var orderId = req.body.orderId;

				var queryString = "SELECT * FROM orders WHERE orderId = ?";
				orderPromise = db.get(queryString, orderId);
			} else {
				// Use table number
				var tableNum = req.body.tableNumber;

				// Only choose orders that are not yet completed
				var queryString = "SELECT * FROM orders WHERE tableNumber = ? AND orderComplete = 0";
				orderPromise = db.get(queryString, tableNum);
			}
			var order = await orderPromise;

			// Check that order exists
			if (!order) {
				res.status(404);
				resBody.reason = `Order with ${ 
					typeof orderId == 'string' ? ("order ID " + orderId) : ("table number " + tableNum) 
				} not found.`;
			} else {
				res.status(200);
				resBody.order = order;
			}
		}

		return res.json(buildResponse(resBody));
	});

	// /api/setorder
	//   Used to modify or add orders to database
	app.post("/api/setorder", async (req, res) => {
		sh.log("POST /api/setorder from " + req.ip, component, true);
		
		// Check client
		if (!checkAcceptedClient(req, res)) return;

		// Check access level
		if (!(await checkAccessLevel(sessions, req, res, 0))) return;

		var resBody = {};

		if (req.body.order === undefined) {
			res.status(400);
			resBody.reason = "Request did not contain an order"
		} else if (req.body.order.orderId === undefined) {
			// No orderId - create new order
			try {
				resBody.orderId = await orders.newOrder(req.body.order);
				res.status(200);
			} catch (e) {
				res.status(400);
				resBody.reason = e.toString();
			}
		} else {
			// orderId was provided - update order
			try {
				resBody.orderId = await orders.updateOrder(req.body.order);
				res.status(200);
			} catch (e) {
				res.status(400);
				resBody.reason = e.toString();
			}
		}

		return res.json(buildResponse(resBody));
	});

	// /api/openorders
	//   Returns order IDs of open orders
	app.post("/api/openorders", async (req, res) => {
		sh.log("POST /api/openOrders/ from " + req.ip, component, true);
		const REQD_ACCESSLVL = 0;

		// Check client name
		if (!checkAcceptedClient(req, res)) return;

		// Check access level
		if (!(await checkAccessLevel(sessions, req, res, 0))) return;

		var resBody = {};
		var rows;

		try {
			rows = await orders.getOpenOrders();
		} catch (ex) {
			sh.log("Error: " + ex.toString(), component);
		}

		var orderIds = rows.map(row => row.orderId);

		resBody.openOrders = orderIds;
		res.status(200);

		res.json(buildResponse(resBody));
	});
}

function checkAccessLevel(sessions, req, res, requiredLevel) {
	return new Promise(async (resolve, cancel) => {
		// Get session id from req
		var sessionId = req.get("sessionId");
		if (!sessionId) {
			// No sessionId was sent. respond with 401 and return false
			res.status(401);
			res.json(buildResponse({ reason: "No sessionId was sent" }));
			resolve(false);
		}

		// Get access level from database
		var accessLevel;
		try {
			accessLevel = await sessions.getAccessLevel(sessionId);
		} catch (ex) {
			res.status(401);
			res.json(buildResponse({ reason: `Error: ${ex.toString()}` }));
			resolve(false);
		}

		// Check access level
		if (accessLevel < requiredLevel) {
			res.status(403);
			res.json(buildResponse({ reason: `Access level ${accessLevel} is too low; minimum ${REQD_ACCESSLVL}` }));
			resolve(false);
		}
		resolve(true);
	});
}

function checkAcceptedClient(req, res) {
	var client = req.get("client");
	var isAcceptedClient = acceptedClients.indexOf(client) > -1; // Check if in acceptedClients

	if (!isAcceptedClient) {
		res.status(400);
		res.json(buildResponse({ reason: "Invalid client name: " + client }));
	}

	return isAcceptedClient;
}

function buildResponse(data={}) {
	data.ordersoft_version = version;
	return JSON.stringify(data);
}