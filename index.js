import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
// import cors from "cors";
// import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const PORT = process.env.PORT || 8000;



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
// const users = db.collection('addDestination');
// const bookingCollection = db.collection('Booking')





app.listen(PORT, () => {
  console.log(`Gear Vault server is running on port ${PORT}`);
});
