const { Client } = require('pg');

(async () => {
  try {
    const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:guigo23102008@localhost:5432/orders_dev';
    console.log('Connecting to:', connectionString.replace(/:[^:]+@/, ':*****@'));

    const client = new Client({ connectionString });
    await client.connect();

    const res = await client.query(`SELECT session_id, LENGTH(session_data) as data_size, created_at, updated_at FROM whatsapp_sessions ORDER BY updated_at DESC`);

    if (res.rows.length === 0) {
      console.log('No sessions found in whatsapp_sessions.');
    } else {
      console.log(`Found ${res.rows.length} sessions:`);
      for (const row of res.rows) {
        console.log({
          session_id: row.session_id,
          data_size_kb: (row.data_size / 1024).toFixed(2) + ' KB',
          created_at: row.created_at,
          updated_at: row.updated_at
        });
      }
    }

    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('Error querying database:', err.message);
    console.error(err);
    process.exit(1);
  }
})();
