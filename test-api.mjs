const emiten = 'SOCI';
const fromDate = '2026-01-01';
const toDate = '2026-01-02';
const token = process.env.STOCKBIT_JWT_TOKEN;
if (!token) {
  throw new Error('Set STOCKBIT_JWT_TOKEN in your local environment before running this script.');
}

async function test() {
  const url = `https://exodus.stockbit.com/marketdetectors/${emiten}?from=${fromDate}&to=${toDate}&transaction_type=TRANSACTION_TYPE_NET&market_board=MARKET_BOARD_REGULER&investor_type=INVESTOR_TYPE_ALL&limit=25`;
  
  console.log('Testing URL:', url);
  
  try {
    const response = await fetch(url, {
      headers: {
        'accept': 'application/json',
        'authorization': `Bearer ${token}`,
        'origin': 'https://stockbit.com',
        'referer': 'https://stockbit.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      }
    });
    
    console.log('Status:', response.status);
    const data = await response.json();
    console.log('Data:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
