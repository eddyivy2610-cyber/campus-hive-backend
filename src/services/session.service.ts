import prisma from "../prisma.ts";
import { generateSessionTokens } from "./token.service.ts";
import bcrypt from "bcrypt";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

type SessionBody = {
    accessToken:string,
    refreshToken:string,
}
interface StartSessionResponse {
    session:SessionBody | null,
    success:boolean,
    message:string
}

export async function startSession(userId:string):Promise<StartSessionResponse> {
    try {
        const expiresAt = new Date(Date.now() + 7 * DAY_IN_MS);
        const newSession = await prisma.session.create({data:{userId:userId, expiresAt}});
        const {accessToken, refreshToken} = generateSessionTokens(userId, newSession.id);
        const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
        await prisma.session.update(
            {
                where:{id:newSession.id},
                data:{refreshTokenHash}
            }
        );

        return {session:{accessToken, refreshToken}, success:true, message:"Session created"};
    } catch(err:any) {
        return {session:null, success:false, message:`Session creation failed: ${err.message || "Unknown error"}`};
    }
}