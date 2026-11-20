import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";
import Stripe from "stripe";
// import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const PORT = process.env.PORT || 8000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Make user input safe to use inside a MongoDB regex.
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");


app.use(cors());
// keep the raw body so the Stripe webhook can verify its signature
app.use(express.json({
  limit: "10mb",
  verify: (req, res, buf) => { req.rawBody = buf; },
}));



const client = new MongoClient(process.env.DB_URI);
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}



const connectedClient = await connectToMongoDB()
const db = connectedClient.db('gear-vault');
const users = db.collection('user');
const addEquipment = db.collection('add-Equipment');
const rentCollection = db.collection('rent-collection');


app.get("/", (req, res) => {
  res.send("Server running fine");
});


// (removed duplicate /users endpoint - the one below returns the array directly)









//stripe payment intent

// app.post(
//   "/create-checkout-session",
//   checkAuthenticatedUser,
//   async (req, res) => {
//     const payload = req.body;
//     // console.log(payload, "payload");

//     // payload = { serviceId: ObjectId, userEmail: "user@example.com" }
//     // console.log(payload.serviceId, "serviceId");

//     // Step-1: Check if the service exists in the database
//     const service = await addEquipment.findOne({
//       _id: new ObjectId(payload.serviceId),
//     });
//     if (!service) {
//       // throw new Error("Service not found");
//       return res.status(404).json({ error: "equipment not found" });
//     }
//     // console.log(service, "service");

//     //   // Step-2: Create a booking in the database with status "pending"
//     const rent = {
//       serviceId: payload.serviceId,
//       userEmail: payload.userEmail,
//       status: "pending",
//       paymentStatus: "unpaid",
//       createdAt: new Date(),
//     };
//     const rentCreateResult = await rentCollection.insertOne(rent);
//     // console.log(rentCreateResult, "rentCreateResult");

//     // Step-3: Create a Stripe Checkout Session
//     const session = await stripe.checkout.sessions.create({
//       line_items: [
//         {
//           // price: service.price,
//           price_data: {
//             currency: "usd",
//             product_data: {
//               name: service.name,
//               description: service.description,
//             },

//             unit_amount: parseInt(service.price * 0.00804 * 100), // Convert BDT to USD and then to cents
//           },

//           quantity: 1,
//         },
//       ],

//       success_url: `${process.env.CLIENT_URL}/payment/success?bookingId=${rentCreateResult.insertedId.toString()}`,
//       cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
//       mode: "payment",
//       metadata: {
//         bookingId: rentCreateResult.insertedId.toString(),
//         userId: payload.userId,
//       },
//     });

//     // console.log(session, "session");

//     res.send({
//       success: true,
//       message: "Checkout session created",
//       data: {
//         redirectUrl: session.url,
//       },
//     });
//   },
// );


app.post("/create-checkout-session",  async (req, res) => {
  try {
    const { equipmentId, customerEmail, startDate, endDate, quantity, contact, address, notes } = req.body;

    if (!ObjectId.isValid(equipmentId)) {
      return res.status(400).json({ error: "Invalid equipment id" });
    }
    if (!customerEmail) {
      return res.status(400).json({ error: "Please login before booking" });
    }
    const equipment = await addEquipment.findOne({ _id: new ObjectId(equipmentId) });
    if (!equipment) return res.status(404).json({ error: "Equipment not found" });

    const qty = Number(quantity);
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (!(qty >= 1) || qty > equipment.quantity || isNaN(start) || isNaN(end) || end < start) {
      return res.status(400).json({ error: "Invalid booking details or not enough quantity" });
    }

    const days = Math.ceil((end - start) / 86400000) + 1;
    const periodDays = { Daily: 1, Weekly: 7, Monthly: 30 }[equipment.rentalType] || 1;
    const totalBDT = equipment.rentPrice * Math.ceil(days / periodDays) * qty;

    const booking = {
      equipmentId,
      equipmentName: equipment.name,
      ownerId: equipment.ownerId,
      ownerEmail: equipment.ownerEmail,
      customerEmail,
      startDate: start,
      endDate: end,
      quantity: qty,
      contact,
      address,
      notes: notes || "",
      totalAmount: totalBDT,
      status: "pending",
      paymentStatus: "unpaid",
      createdAt: new Date(),
    };
    const { insertedId } = await rentCollection.insertOne(booking);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: customerEmail,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          product_data: { name: `${equipment.name} (${days} days x ${qty})` },
          unit_amount: Math.round(totalBDT * 0.00804 * 100),
        },
      }],
      metadata: { bookingId: insertedId.toString() },
      success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
    });

    res.send({ success: true, data: { redirectUrl: session.url } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// Marks an unpaid booking as paid and saves a payment record.
// Both the success page (/payment/confirm) and the Stripe webhook call this.
async function markBookingPaid(session) {
  const bookingIdValue = session.metadata?.bookingId;
  if (!bookingIdValue) return; // not one of our checkout sessions

  const bookingId = new ObjectId(bookingIdValue);
  const updated = await rentCollection.updateOne(
    { _id: bookingId, paymentStatus: "unpaid" },
    { $set: { paymentStatus: "paid", status: "confirmed", paidAt: new Date() } }
  );

  // modifiedCount is 0 when this booking was already confirmed, so we never save twice.
  if (!updated.modifiedCount) return;

  await db.collection("payments").insertOne({
    bookingId,
    transactionId: session.payment_intent,
    amount: session.amount_total / 100,
    currency: session.currency,
    customerEmail: session.customer_email,
    createdAt: new Date(),
  });
}

// call this from the success page
app.post("/payment/confirm", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.body.sessionId);
    if (session.payment_status !== "paid") {
      return res.status(400).json({ error: "Payment not completed" });
    }
    await markBookingPaid(session);
    res.send({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not confirm payment" });
  }
});

// Stripe calls this after a payment. It works even if the user closes the success page.
app.post("/webhook", async (req, res) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET in .env");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.payment_status === "paid") {
        await markBookingPaid(session);
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Webhook failed" });
  }
});


















app.get('/my-rentals', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Email parameter is required" });
    }

    // Find all bookings for this customer email, sorted newest first
    const bookings = await rentCollection
      .find({ customerEmail: String(email) })
      .sort({ createdAt: -1 })
      .toArray();

    // For each booking, join equipment details from add-Equipment
    const rentals = await Promise.all(
      bookings.map(async (booking) => {
        const equipment = await addEquipment.findOne({
          _id: new ObjectId(booking.equipmentId),
        });
        return {
          ...booking,
          equipmentImage: equipment?.image || "",
          equipmentCategory: equipment?.category || "",
          equipmentLocation: equipment?.location || "",
        };
      })
    );

    res.send(rentals);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load rentals" });
  }
});

app.get('/users', async (req, res) => {
  
    const cursor = users.find({});
    const result = await cursor.toArray();
    res.send(result);
})

// Update a user's profile (name, image, role)
app.patch('/users/:id', async (req, res) => {
  try {
    const { name, image, role } = req.body;
    const updates = { updatedAt: new Date() };
    if (name) updates.name = name;
    if (image !== undefined) updates.image = image;
    if (role && ['customer', 'admin', 'owner'].includes(role)) updates.role = role;

    const result = await users.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updates }
    );
    if (!result.matchedCount) {
      return res.status(404).json({ error: 'User not found' });
    }
    // Return the updated user
    const updated = await users.findOne({ _id: new ObjectId(req.params.id) });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
})

// Delete a user
app.delete('/users/:id', async (req, res) => {
  try {
    const result = await users.deleteOne({ _id: new ObjectId(req.params.id) });
    if (!result.deletedCount) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
})




// app.post('/equipment', async (req, res) => {
//     const now = new Date().toISOString();
//     const result = await addEquipment.insertOne(req.body);
//     res.send(result);
// })
app.post('/equipment', async (req, res) => {
  try {
    const equipment = {
      ...req.body,
      createdAt: new Date().toISOString(),
    };

    const result = await addEquipment.insertOne(equipment);

    res.status(201).send(result);
  } catch (error) {
    res.status(500).send({ message: 'Failed to add equipment' });
  }
});






app.get('/equipment', async (req, res) => {



   const query = {};
    // console.log('query', req.query);
    if (req.query) {
        if (req.query.category) {
            query.category = req.query.category;
        }
        if (req.query.rentalType) {
            query.rentalType = req.query.rentalType;
        }
        if (req.query.location) {
            // Match any location that contains the text, e.g. "Dhaka" finds "Dhaka, Bangladesh".
            query.location = { $regex: escapeRegex(req.query.location), $options: 'i' };
        }
        if (req.query.condition) {
            query.condition = req.query.condition;
        }
        if (req.query.status) {
            // status can be one value or a list: "Approved,Pending"
            const statuses = req.query.status.split(',');
            query.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
        }
        if (req.query.minPrice || req.query.maxPrice) {
            query.rentPrice = {};
            if (req.query.minPrice) {
                query.rentPrice.$gte = Number(req.query.minPrice);
            }
            if (req.query.maxPrice) {
                query.rentPrice.$lte = Number(req.query.maxPrice);
            }
        }
         if (req.query.ownerId) {
            query.ownerId = req.query.ownerId;
        }
        // if (req.query.search) {
        //     query.$or = [
        //         { brand: { $regex: req.query.search, $options: 'i' } },
        //         { model: { $regex: req.query.search, $options: 'i' } },
        //         { name: { $regex: req.query.search, $options: 'i' } },
        //         { location: { $regex: req.query.search, $options: 'i' } }
        //     ];
        // }
        if (req.query.search) {
  const s = escapeRegex(req.query.search);
  query.$or = [
    { brand: { $regex: s, $options: 'i' } },
    { model: { $regex: s, $options: 'i' } },
    { name: { $regex: s, $options: 'i' } },
    { location: { $regex: s, $options: 'i' } },
    { category: { $regex: s, $options: 'i' } },
  ];
}
    }



let cursor = addEquipment.find(query);
if (req.query.sort === 'newest') cursor = cursor.sort({ createdAt: -1 });
if (req.query.limit) cursor = cursor.limit(Number(req.query.limit));
const result = await cursor.toArray();
res.send(result);

    // const cursor = addEquipment.find(query);
    // const result = await cursor.toArray();
    // res.send(result);
})




app.get('/equipment/:id', async (req, res) => {
    const equipment = await addEquipment.findOne({ _id: new ObjectId(req.params.id) });
    if (!equipment) {
        return res.status(404).send({ message: "Equipment not found" });
    }
    res.send(equipment);
})

app.patch('/equipment/:id', async (req, res) => {
    const { _id, ...updates } = req.body;
    const result = await addEquipment.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: updates }
    );
    if (!result.matchedCount) {
        return res.status(404).send({ message: "Equipment not found" });
    }
    res.send(result);
})

app.delete('/equipment/:id', async (req, res) => {
    const result = await addEquipment.deleteOne({ _id: new ObjectId(req.params.id) });
    if (!result.deletedCount) {
        return res.status(404).send({ message: "Equipment not found" });
    }
    res.send(result);
})




app.listen(PORT, () => {
  console.log(`Gear Vault server is running on port ${PORT}`);
});
