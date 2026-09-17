const PRODUCT_ID = 'prd_credit_100';
const statusBox = document.getElementById('status');
const container = document.getElementById('paypal-button-container');

function setStatus(message, bad = false) {
  statusBox.textContent = message;
  statusBox.style.color = bad ? '#a04e45' : 'var(--good)';
}

async function loadJson(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function loadPayPal(clientId) {
  return new Promise((resolve, reject) => {
    if (window.paypal) return resolve(window.paypal);
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
    script.onload = () => resolve(window.paypal);
    script.onerror = () => reject(new Error('Could not load PayPal Checkout.'));
    document.head.appendChild(script);
  });
}

async function start() {
  try {
    const account = await loadJson('/api/account');
    if (!account.user) {
      setStatus('Please sign in before purchasing credits.', true);
      return;
    }

    const config = await loadJson('/api/paypal/config');
    if (!config.configured) {
      setStatus('PayPal is not configured on the Worker yet.', true);
      return;
    }

    setStatus('Loading PayPal Checkout…');
    const paypal = await loadPayPal(config.client_id);
    paypal.Buttons({
      style: { layout: 'vertical', shape: 'rect', label: 'paypal' },
      async createOrder() {
        const data = await loadJson('/api/paypal/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: PRODUCT_ID }),
        });
        return data.id;
      },
      async onApprove(data) {
        setStatus('Confirming your payment…');
        try {
          await loadJson('/api/paypal/capture-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: data.orderID }),
          });
          setStatus('Payment completed. Your credits are now in your account.');
        } catch (error) {
          setStatus(error.message, true);
        }
      },
      onCancel() {
        setStatus('Payment cancelled.');
      },
      onError(error) {
        console.error(error);
        setStatus('PayPal could not complete this checkout.', true);
      },
    }).render('#paypal-button-container');
  } catch (error) {
    setStatus(error.message, true);
  }
}

start();
