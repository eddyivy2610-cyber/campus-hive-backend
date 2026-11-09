import { Request, Response } from "express";
import prisma from "../prisma.ts";
import bcrypt from "bcrypt";
import { validateEmail } from "../lib/email.ts";
import { startSession } from "../services/session.service.ts";


export async function signin(req:Request, res:Response):Promise<void> {
    try {
        const {email, password} = req.body;

        if (!email || !validateEmail(email)) {
        res.status(400).json({ message: "Invalid Email Address: Valid address is required" });
        return;
        }
        if (!password) {
        res.status(400).json({ message: "Password is required" });
        return;
        }

        // validate token
        const user = await prisma.user.findUnique({
            where:{
                email:email
            },
        });
        if (!user) {
            res.status(401).json({ message: "Invalid email or password", error:"bad credentials" });
            return;
        }
        
        const isPasswordMatch = await bcrypt.compare(password, user.passwordHash);

        if (!isPasswordMatch) {
            res.status(401).json({ message: "Invalid email or password", error:"bad credentials" });
            return;
        }

        let session = await startSession(user.id);
        if (!session.success) {
            // retry
            session =  await startSession(user.id);
        }
        if (!session.success) {
            res.status(400).json({ message: "Failed to start session", error:session.message });
            return;
        }

        res.status(200).json({
            success:true, 
            session, 
            user:{
                id:user.id, 
                username:user.username, 
                profileImage:user.profileImage || null, 
                role:user.role
            }, 
            message:"Session created successfully"
        });

    } catch (error) {
        console.error("Error during signup verification:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}