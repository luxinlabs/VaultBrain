import { getDb } from './client';
import bcrypt from 'bcrypt';

const db = getDb();

async function seed() {
  console.log('Seeding VaultBrain database...');
  try {
    const partnerEmail = process.env.SEED_PARTNER_EMAIL;
    const partnerPassword = process.env.SEED_PARTNER_PASSWORD;
    const analystEmail = process.env.SEED_ANALYST_EMAIL;
    const analystPassword = process.env.SEED_ANALYST_PASSWORD;

    if (!partnerEmail || !partnerPassword) {
      throw new Error('SEED_PARTNER_EMAIL and SEED_PARTNER_PASSWORD are required to bootstrap the first account');
    }

    const partnerHash = await bcrypt.hash(partnerPassword, 10);
    db.run('INSERT OR IGNORE INTO dealflow_users (id,email,name,role,password_hash) VALUES (?,?,?,?,?)', 'user-1', partnerEmail, partnerEmail.split('@')[0], 'partner', partnerHash);
    console.log(`✓ Created partner account for ${partnerEmail}`);

    if (analystEmail && analystPassword) {
      const analystHash = await bcrypt.hash(analystPassword, 10);
      db.run('INSERT OR IGNORE INTO dealflow_users (id,email,name,role,password_hash) VALUES (?,?,?,?,?)', 'user-2', analystEmail, analystEmail.split('@')[0], 'analyst', analystHash);
      console.log(`✓ Created analyst account for ${analystEmail}`);
    } else {
      console.log('ℹ️  Skipped analyst account (set SEED_ANALYST_EMAIL and SEED_ANALYST_PASSWORD to create one)');
    }

    console.log('\n✅ Database seeded with authentication users only. All founder data will be fetched live from The Hog.');
  } catch (e) { console.error('✗ Seed failed:', e); }
}

seed();
