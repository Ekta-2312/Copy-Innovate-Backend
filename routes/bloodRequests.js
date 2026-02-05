const express = require('express');
const router = express.Router();
const bloodRequestController = require('../controllers/bloodRequestController');
const BloodRequest = require('../models/BloodRequest');
const Hospital = require('../models/Hospital');
const DonationHistory = require('../models/DonationHistory');
const Notification = require('../models/Notification');
const { broadcastNotification } = require('../utils/notificationStream');

// Analytics: Get total requests count
router.get('/admin/analytics/total-requests', async (req, res) => {
  try {
    const totalRequests = await BloodRequest.countDocuments({});
    res.json({ success: true, data: totalRequests });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch total requests' });
  }
});

// Analytics: Get donors responded count
router.get('/admin/analytics/donors-responded', async (req, res) => {
  try {
    console.log('=== Fetching donors responded count ===');
    
    // Use direct MongoDB connection to query donationhistories collection
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    const collection = db.collection('donationhistories');
    
    // Count all completed donations
    const completedCount = await collection.countDocuments({ status: 'completed' });
    console.log('Completed donations count:', completedCount);
    
    // Also get total count for debugging
    const totalCount = await collection.countDocuments({});
    console.log('Total donations in collection:', totalCount);
    
    res.json({ 
      success: true, 
      data: completedCount 
    });
  } catch (error) {
    console.error('Error fetching donors responded:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch donors responded',
      error: error.message 
    });
  }
});

// Analytics: Get fulfillment rate
router.get('/admin/analytics/fulfillment-rate', async (req, res) => {
  try {
    const totalRequests = await BloodRequest.countDocuments({});
    const fulfilledRequests = await BloodRequest.countDocuments({
      status: { $in: ['fulfilled', 'completed'] }
    });
    
    const fulfillmentRate = totalRequests > 0 ? Math.round((fulfilledRequests / totalRequests) * 100) : 0;
    res.json({ success: true, data: fulfillmentRate });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch fulfillment rate' });
  }
});

// Analytics: Get average response time
router.get('/admin/analytics/avg-response-time', async (req, res) => {
  try {
    const fulfilledRequests = await BloodRequest.find({
      status: { $in: ['fulfilled', 'completed'] },
      updatedAt: { $exists: true }
    }).select('createdAt updatedAt');
    
    if (fulfilledRequests.length === 0) {
      return res.json({ success: true, data: '0m 0s' });
    }
    
    const totalResponseTime = fulfilledRequests.reduce((acc, request) => {
      const responseTime = request.updatedAt - request.createdAt;
      return acc + responseTime;
    }, 0);
    
    const avgResponseTimeMs = totalResponseTime / fulfilledRequests.length;
    const minutes = Math.floor(avgResponseTimeMs / (1000 * 60));
    const seconds = Math.floor((avgResponseTimeMs % (1000 * 60)) / 1000);
    
    res.json({ success: true, data: `${minutes}m ${seconds}s` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch average response time' });
  }
});

// Analytics: Get combined stats for admin dashboard
router.get('/admin/analytics/stats', async (req, res) => {
  try {
    console.log('Fetching admin analytics stats...');
    
    // Get total requests
    const totalRequests = await BloodRequest.countDocuments({});
    
    // Get fulfilled requests
    const fulfilledRequests = await BloodRequest.countDocuments({
      status: { $in: ['fulfilled', 'completed'] }
    });
    
    // Calculate fulfillment rate
    const fulfillmentRate = totalRequests > 0 ? Math.round((fulfilledRequests / totalRequests) * 100) : 0;
    
    // Get donors responded (completed donations)
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    const collection = db.collection('donationhistories');
    const donorsResponded = await collection.countDocuments({ status: 'completed' });
    
    // Calculate average response time
    const responseTimeRequests = await BloodRequest.find({
      status: { $in: ['fulfilled', 'completed'] },
      updatedAt: { $exists: true }
    }).select('createdAt updatedAt');
    
    let avgResponseTime = '0m 0s';
    if (responseTimeRequests.length > 0) {
      const totalResponseTime = responseTimeRequests.reduce((acc, request) => {
        const responseTime = request.updatedAt - request.createdAt;
        return acc + responseTime;
      }, 0);
      
      const avgResponseTimeMs = totalResponseTime / responseTimeRequests.length;
      const minutes = Math.floor(avgResponseTimeMs / (1000 * 60));
      const seconds = Math.floor((avgResponseTimeMs % (1000 * 60)) / 1000);
      avgResponseTime = `${minutes}m ${seconds}s`;
    }
    
    const stats = {
      totalRequests,
      donorsResponded,
      fulfillmentRate,
      avgResponseTime
    };
    
    console.log('Total blood requests:', totalRequests);
    console.log('Donors who completed donations:', donorsResponded);
    console.log('Fulfillment rate:', fulfillmentRate);
    
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error fetching admin analytics stats:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics stats' });
  }
});

// Analytics: Weekly blood request trends for admin dashboard
router.get('/admin/analytics/request-trends', async (req, res) => {
  try {
    // Get last 4 weeks including current week
    const now = new Date();
    const weeks = [];
    
    for (let i = 3; i >= 0; i--) {
      const start = new Date(now);
      start.setDate(start.getDate() - i * 7);
      start.setHours(0, 0, 0, 0);
      
      const end = new Date(now);
      end.setDate(end.getDate() - (i - 1) * 7);
      end.setHours(23, 59, 59, 999);
      
      weeks.push({ start, end });
    }

    const data = await Promise.all(weeks.map(async (w, idx) => {
      const count = await BloodRequest.countDocuments({
        createdAt: { $gte: w.start, $lte: w.end }
      });
      
      // Format dates to show meaningful labels
      const startDate = w.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endDate = w.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      
      // Show "This Week" for current week, otherwise date range
      const isCurrentWeek = idx === 3;
      const label = isCurrentWeek ? 'This Week' : `${startDate} - ${endDate}`;
      
      return {
        label: label,
        value: count,
        color: '#dc2626'
      };
    }));

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch request trends' });
  }
});


// Create a new blood request
// Create a new blood request
router.post('/', bloodRequestController.createBloodRequest);

// Get all blood requests for a hospital (for dashboard)
router.get('/hospital', async (req, res) => {
  try {
    const hospital = req.user; // From JWT token
    
    // Find the hospital document to get the hospital name
    const hospitalDoc = await Hospital.findById(hospital.id).select('name');
    const hospitalName = hospitalDoc ? hospitalDoc.name : 'Unknown Hospital';
    
    const bloodRequests = await BloodRequest.find({ hospitalId: hospital.id })
      .sort({ createdAt: -1 })
      .select('_id bloodGroup quantity urgency status createdAt requiredBy description');
    
    // Add hospital name to each blood request
    const bloodRequestsWithHospital = bloodRequests.map(request => ({
      ...request.toObject(),
      hospitalName: hospitalName
    }));
    
    res.json({
      success: true,
      bloodRequests: bloodRequestsWithHospital
    });
  } catch (error) {
    console.error('Error fetching hospital blood requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch blood requests'
    });
  }
});

// Get all blood requests for donation history (public endpoint)
router.get('/all', async (req, res) => {
  try {
    const bloodRequests = await BloodRequest.find({})
      .sort({ createdAt: -1 })
      .select('_id bloodGroup quantity urgency status createdAt requiredBy description hospitalId');
    
    res.json({
      success: true,
      bloodRequests
    });
  } catch (error) {
    console.error('Error fetching all blood requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch blood requests'
    });
  }
});

// PUT /blood-requests/:id - Update a blood request
router.put('/:id', async (req, res) => {
  try {
    const bloodRequest = await BloodRequest.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!bloodRequest) {
      return res.status(404).json({ success: false, message: 'Blood request not found' });
    }
    
    // Create notification for blood request update
    try {
      const notif = await Notification.create({
        hospitalId: bloodRequest.hospitalId,
        type: 'info',
        title: 'Blood Request Updated',
        message: `Blood request for ${bloodRequest.bloodGroup} (${bloodRequest.quantity} units) was updated`,
        read: false,
        meta: { bloodRequestId: bloodRequest._id }
      });
      broadcastNotification(notif);
    } catch (e) { console.error('Failed to create blood request update notification:', e.message); }
    
    res.json({ success: true, message: 'Blood request updated successfully', bloodRequest });
  } catch (error) {
    console.error('Error updating blood request:', error);
    res.status(500).json({ success: false, message: 'Failed to update blood request' });
  }
});

// DELETE /blood-requests/:id - Delete a blood request
router.delete('/:id', async (req, res) => {
  try {
    const bloodRequest = await BloodRequest.findByIdAndDelete(req.params.id);
    if (!bloodRequest) {
      return res.status(404).json({ success: false, message: 'Blood request not found' });
    }
    
    // Create notification for blood request deletion
    try {
      const notif = await Notification.create({
        hospitalId: bloodRequest.hospitalId,
        type: 'warning',
        title: 'Blood Request Deleted',
        message: `Blood request for ${bloodRequest.bloodGroup} (${bloodRequest.quantity} units) was deleted`,
        read: false,
        meta: { bloodRequestId: bloodRequest._id }
      });
      broadcastNotification(notif);
    } catch (e) { console.error('Failed to create blood request deletion notification:', e.message); }
    
    res.json({ success: true, message: 'Blood request deleted successfully' });
  } catch (error) {
    console.error('Error deleting blood request:', error);
    res.status(500).json({ success: false, message: 'Failed to delete blood request' });
  }
});

// Analytics: Get fulfillment rate pie chart data
router.get('/admin/analytics/fulfillment-pie', async (req, res) => {
  try {
    const totalRequests = await BloodRequest.countDocuments({});
    const fulfilledRequests = await BloodRequest.countDocuments({
      status: { $in: ['fulfilled', 'completed'] }
    });
    const pendingRequests = await BloodRequest.countDocuments({
      status: 'pending'
    });
    const cancelledRequests = await BloodRequest.countDocuments({
      status: 'cancelled'
    });
    
    const data = [
      { label: 'Fulfilled', value: fulfilledRequests, color: '#10b981' },
      { label: 'Pending', value: pendingRequests, color: '#f59e0b' },
      { label: 'Cancelled', value: cancelledRequests, color: '#ef4444' }
    ];
    
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch fulfillment data' });
  }
});

// Analytics: Get donors response by blood type
router.get('/admin/analytics/donors-by-blood-type', async (req, res) => {
  try {
    console.log('=== Fetching donors by blood type ===');
    
    const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    const colors = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];
    
    // Use direct MongoDB connection
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    const collection = db.collection('donationhistories');
    
    const data = await Promise.all(bloodTypes.map(async (bloodType, index) => {
      const count = await collection.countDocuments({
        donorBloodGroup: bloodType,
        status: 'completed'
      });
      console.log(`Blood type ${bloodType}: ${count} completed donations`);
      
      return {
        label: bloodType,
        value: count,
        color: colors[index]
      };
    }));
    
    // Always return all blood groups, even if count is 0
    console.log('Final data:', data);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching blood type data:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch blood type data' });
  }
});

// Analytics: Get average response time by hour
router.get('/admin/analytics/response-time-by-hour', async (req, res) => {
  try {
    const timeSlots = [
      { label: '6AM-9AM', start: 6, end: 9, color: '#3b82f6' },
      { label: '9AM-12PM', start: 9, end: 12, color: '#3b82f6' },
      { label: '12PM-3PM', start: 12, end: 15, color: '#3b82f6' },
      { label: '3PM-6PM', start: 15, end: 18, color: '#3b82f6' },
      { label: '6PM-9PM', start: 18, end: 21, color: '#3b82f6' },
      { label: '9PM-12AM', start: 21, end: 24, color: '#3b82f6' }
    ];
    
    const data = await Promise.all(timeSlots.map(async (slot) => {
      const requests = await BloodRequest.find({
        status: { $in: ['fulfilled', 'completed'] },
        updatedAt: { $exists: true }
      }).select('createdAt updatedAt');
      
      // Filter requests created in this time slot
      const slotRequests = requests.filter(request => {
        const hour = request.createdAt.getHours();
        return hour >= slot.start && hour < slot.end;
      });
      
      if (slotRequests.length === 0) {
        return {
          label: slot.label,
          value: 0,
          color: slot.color
        };
      }
      
      const totalResponseTime = slotRequests.reduce((acc, request) => {
        const responseTime = request.updatedAt - request.createdAt;
        return acc + responseTime;
      }, 0);
      
      const avgResponseTimeMin = Math.round(totalResponseTime / (slotRequests.length * 1000 * 60));
      
      return {
        label: slot.label,
        value: avgResponseTimeMin,
        color: slot.color
      };
    }));
    
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch response time by hour' });
  }
});

// Analytics: Get fulfillment rate breakdown
router.get('/admin/analytics/fulfillment-breakdown', async (req, res) => {
  try {
    console.log('=== Fetching fulfillment breakdown ===');
    
    const statusCounts = await BloodRequest.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);

    console.log('Status counts from DB:', statusCounts);

    const total = statusCounts.reduce((sum, item) => sum + item.count, 0);
    console.log('Total requests:', total);

    // Ensure we have all statuses represented
    const allStatuses = ['fulfilled', 'pending', 'cancelled', 'active'];
    const fulfillmentData = allStatuses.map(status => {
      const statusData = statusCounts.find(item => item._id === status);
      const count = statusData ? statusData.count : 0;
      
      let color = '#059669'; // fulfilled - green
      if (status === 'pending') color = '#eab308'; // pending - yellow  
      if (status === 'cancelled') color = '#dc2626'; // cancelled - red
      if (status === 'active') color = '#3b82f6'; // active - blue

      return {
        label: status.charAt(0).toUpperCase() + status.slice(1),
        value: count, // Use actual count for pie chart
        color: color
      };
    }).filter(item => item.value > 0); // Only show statuses that have data

    // If no data, provide sample data for demonstration
    if (fulfillmentData.length === 0) {
      fulfillmentData.push(
        { label: 'Fulfilled', value: 2, color: '#059669' },
        { label: 'Pending', value: 1, color: '#eab308' }
      );
    }

    console.log('Final fulfillment data:', fulfillmentData);
    res.json({ success: true, data: fulfillmentData });
  } catch (error) {
    console.error('Error fetching fulfillment breakdown:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch fulfillment breakdown' });
  }
});

// Admin: Get audit logs from notifications
router.get('/admin/audit-logs', async (req, res) => {
  try {
    console.log('=== Fetching audit logs ===');
    console.log('Request user:', req.user);
    console.log('Request headers:', req.headers);
    
    // Fetch notifications with populated hospital data, sorted by newest first
    const notifications = await Notification.find({})
      .populate({
        path: 'hospitalId',
        select: 'name',
        model: 'Hospital'
      })
      .populate({
        path: 'bloodRequestId',
        select: 'bloodType unitsRequired status',
        model: 'BloodRequest'
      })
      .sort({ createdAt: -1 })
      .limit(50); // Limit to last 50 logs

    console.log('Found notifications:', notifications.length);

    // Transform notifications into audit log format
    const auditLogs = notifications.map((notification, index) => {
      // Determine action based on notification title/message
      let action = 'Activity';
      let details = notification.message;
      
      if (notification.title.toLowerCase().includes('request')) {
        action = 'Blood Request';
        if (notification.bloodRequestId) {
          details = `${notification.message} (${notification.bloodRequestId.bloodType}, ${notification.bloodRequestId.unitsRequired} units)`;
        }
      } else if (notification.title.toLowerCase().includes('donor')) {
        action = 'Donor Activity';
      } else if (notification.title.toLowerCase().includes('login') || notification.title.toLowerCase().includes('logged')) {
        action = 'Login';
      } else if (notification.title.toLowerCase().includes('response')) {
        action = 'Donor Response';
      }

      // Determine log type based on notification type
      let logType = 'other';
      if (notification.type === 'success') logType = 'notification';
      else if (notification.type === 'info') logType = 'location';
      else if (notification.type === 'warning') logType = 'other';
      else if (notification.type === 'error') logType = 'other';

      return {
        id: notification._id,
        action: action,
        details: details,
        hospital: notification.hospitalId ? notification.hospitalId.name : 'System',
        timestamp: new Date(notification.createdAt).toLocaleString('en-IN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }),
        type: logType,
        originalType: notification.type,
        createdAt: notification.createdAt
      };
    });

    console.log('Transformed audit logs:', auditLogs.length);
    res.json({ success: true, data: auditLogs });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch audit logs' });
  }
});

module.exports = router;
