const clients = new Map(); // hospitalId -> Set(res)

function addClient(hospitalId, res) {
  if (!clients.has(hospitalId)) clients.set(hospitalId, new Set());
  clients.get(hospitalId).add(res);
  console.log(`✅ SSE Client connected for hospital ${hospitalId} (Total: ${clients.get(hospitalId).size} connection(s))`);
  res.on('close', () => removeClient(hospitalId, res));
}

function removeClient(hospitalId, res) {
  const set = clients.get(hospitalId);
  if (set) {
    set.delete(res);
    console.log(`❌ SSE Client disconnected for hospital ${hospitalId} (Remaining: ${set.size} connection(s))`);
    if (set.size === 0) {
      clients.delete(hospitalId);
      console.log(`🗑️ No more connections for hospital ${hospitalId}, removed from clients map`);
    }
  }
}

function broadcastNotification(notification) {
  const hospitalId = notification.hospitalId?.toString();
  console.log(`📡 Broadcasting notification for hospital: ${hospitalId || 'ALL'}`);
  console.log(`👥 Total connected hospitals: ${clients.size}`);

  if (!hospitalId) {
    // Global broadcast (no hospitalId)
    const payload = `data: ${JSON.stringify({ type: 'notification', notification })}\n\n`;
    let broadcastCount = 0;
    for (const [hId, set] of clients.entries()) {
      console.log(`  → Hospital ${hId}: ${set.size} connection(s)`);
      for (const res of set) {
        res.write(payload);
        broadcastCount++;
      }
    }
    console.log(`✅ Broadcasted to ${broadcastCount} client(s)`);
    return;
  }

  const set = clients.get(hospitalId);
  if (!set || set.size === 0) {
    console.log(`⚠️ No connected clients for hospital ${hospitalId}`);
    console.log(`   Connected hospitals: ${Array.from(clients.keys()).join(', ') || 'none'}`);
    return;
  }

  const payload = `data: ${JSON.stringify({ type: 'notification', notification })}\n\n`;
  console.log(`  → Sending to ${set.size} connection(s) for hospital ${hospitalId}`);
  for (const res of set) {
    res.write(payload);
  }
  console.log(`✅ Broadcasted to ${set.size} client(s) for hospital ${hospitalId}`);
}

function getConnectedClients() {
  const hospitals = [];
  for (const [hospitalId, set] of clients.entries()) {
    hospitals.push({
      hospitalId,
      connections: set.size
    });
  }
  return {
    size: clients.size,
    hospitals
  };
}

module.exports = { addClient, removeClient, broadcastNotification, getConnectedClients };
