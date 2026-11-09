import { generateToken } from "../lib/generate.ts";
import prisma from "../prisma.ts";

export async function generateVerificationToken() {
  let hasFoundUniqueToken:boolean = false;
  let token = generateToken("vt");
  while (!hasFoundUniqueToken) {
    const existingToken = await prisma.verificationToken.findUnique({
      where: { token },
    });
    hasFoundUniqueToken = existingToken ? false : true;
  }
  return token;
}