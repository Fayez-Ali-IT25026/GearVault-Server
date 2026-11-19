import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";
// import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const PORT = process.env.PORT || 8000;


app.use(cors());
app.use(express.json({ limit: "10mb" }));



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
// const bookingCollection = db.collection('Booking')


app.get("/", (req, res) => {
  res.send("Server running fine");
});



app.get('/users', async (req, res) => {
  
    const cursor = users.find({});
    const result = await cursor.toArray();
    res.send(result);
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
            query.location = req.query.location;
        }
         if (req.query.ownerId) {
            query.ownerId = req.query.ownerId;
        }
        if (req.query.search) {
            query.$or = [
                { brand: { $regex: req.query.search, $options: 'i' } },
                { model: { $regex: req.query.search, $options: 'i' } },
                { name: { $regex: req.query.search, $options: 'i' } },
                { location: { $regex: req.query.search, $options: 'i' } }
            ];
        }
    }





    const cursor = addEquipment.find(query);
    const result = await cursor.toArray();
    res.send(result);
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
