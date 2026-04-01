import mongoose from 'mongoose';
import User from './models/User.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

async function testSave() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');
  
  try {
    const random = Math.floor(Math.random() * 100000);
    const user = new User({
      email: `test_${random}@example.com`,
      password: 'password123',
      profile: {
        displayName: `TestUser_${random}`,
        bio: 'Test bio',
      },
      role: 'buyer',
      agreedToTerms: true,
      provider: 'email',
    });
    
    console.log('Saving user...');
    await user.save();
    console.log('User saved successfully');
  } catch (err) {
    console.error('Save failed:', err);
  } finally {
    await mongoose.connection.close();
  }
}

testSave();
