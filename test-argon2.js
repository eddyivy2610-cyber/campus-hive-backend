import argon2 from 'argon2';
try {
  const hash = await argon2.hash('password123', {
    type: argon2.argon2id,
    memoryCost: 2 ** 12,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
    saltLength: 16,
  });
  console.log('Argon2 success:', hash.substring(0, 10) + '...');
} catch (err) {
  console.error('Argon2 failed:', err);
}
