const nodemailer = require('nodemailer');

// Create transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP email for registration
const sendRegistrationOTP = async (email, otp, name) => {
  const mailOptions = {
    from: `"RaktMap Blood Donation" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Verify Your Email - RaktMap Registration',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #DC2626 0%, #991B1B 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
          .otp-box { background: white; border: 2px dashed #DC2626; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; }
          .otp-code { font-size: 32px; font-weight: bold; color: #DC2626; letter-spacing: 5px; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🩸 Welcome to RaktMap!</h1>
          </div>
          <div class="content">
            <h2>Hello ${name}!</h2>
            <p>Thank you for registering with RaktMap Blood Donation System.</p>
            <p>To complete your registration and verify your email address, please use the following One-Time Password (OTP):</p>
            
            <div class="otp-box">
              <p style="margin: 0; font-size: 14px; color: #666;">Your OTP Code</p>
              <p class="otp-code">${otp}</p>
              <p style="margin: 0; font-size: 12px; color: #999;">Valid for 10 minutes</p>
            </div>
            
            <p><strong>Important:</strong></p>
            <ul>
              <li>This OTP is valid for 10 minutes only</li>
              <li>Do not share this code with anyone</li>
              <li>If you didn't request this, please ignore this email</li>
            </ul>
            
            <p>After verification, you'll be able to:</p>
            <ul>
              <li>Create blood requests</li>
              <li>View available donors on live map</li>
              <li>Track donation history</li>
              <li>Manage your hospital profile</li>
            </ul>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
            <p>&copy; 2025 RaktMap Blood Donation System. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('✅ Registration OTP sent to:', email);
    return true;
  } catch (error) {
    console.error('❌ Error sending registration OTP:', error);
    throw error;
  }
};

// Send password reset OTP
const sendPasswordResetOTP = async (email, otp, name) => {
  const mailOptions = {
    from: `"RaktMap Blood Donation" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Password Reset Request - RaktMap',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #DC2626 0%, #991B1B 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
          .otp-box { background: white; border: 2px dashed #DC2626; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; }
          .otp-code { font-size: 32px; font-weight: bold; color: #DC2626; letter-spacing: 5px; }
          .warning { background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 15px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Password Reset Request</h1>
          </div>
          <div class="content">
            <h2>Hello ${name}!</h2>
            <p>We received a request to reset your password for your RaktMap account.</p>
            <p>To proceed with resetting your password, please use the following OTP:</p>
            
            <div class="otp-box">
              <p style="margin: 0; font-size: 14px; color: #666;">Your OTP Code</p>
              <p class="otp-code">${otp}</p>
              <p style="margin: 0; font-size: 12px; color: #999;">Valid for 10 minutes</p>
            </div>
            
            <div class="warning">
              <p style="margin: 0;"><strong>⚠️ Security Alert:</strong></p>
              <p style="margin: 5px 0 0 0;">If you didn't request a password reset, please ignore this email and ensure your account is secure.</p>
            </div>
            
            <p><strong>Next Steps:</strong></p>
            <ol>
              <li>Enter this OTP on the password reset page</li>
              <li>Create a new strong password</li>
              <li>Log in with your new credentials</li>
            </ol>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
            <p>&copy; 2025 RaktMap Blood Donation System. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('✅ Password reset OTP sent to:', email);
    return true;
  } catch (error) {
    console.error('❌ Error sending password reset OTP:', error);
    throw error;
  }
};

module.exports = {
  generateOTP,
  sendRegistrationOTP,
  sendPasswordResetOTP
};
