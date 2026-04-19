
import * as admin from 'firebase-admin';

// Initialize Firebase Admin (assumes GOOGLE_APPLICATION_CREDENTIALS or default auth)
if (admin.apps.length === 0) {
    admin.initializeApp({
        projectId: process.env.GOOGLE_CLOUD_PROJECT || 'profit-step'
    });
}

async function createTestUser() {
    const email = 'test_admin@profitstep.com';
    const password = 'password123';
    const displayName = 'Test Admin';

    try {
        // 1. Check if exists
        try {
            const user = await admin.auth().getUserByEmail(email);
            console.log(`User ${email} already exists. UID: ${user.uid}`);
            // Reset password just in case
            await admin.auth().updateUser(user.uid, { password });
            console.log('Password reset to:', password);
            return;
        } catch (e: any) {
            if (e.code !== 'auth/user-not-found') throw e;
        }

        // 2. Create User
        const user = await admin.auth().createUser({
            email,
            password,
            displayName,
            emailVerified: true
        });

        console.log(`Created user: ${user.uid}`);

        // 3. Create Firestore Profile
        await admin.firestore().collection('users').doc(user.uid).set({
            email,
            displayName,
            role: 'admin',
            companyId: 'test_company',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log('Firestore profile created.');

    } catch (error) {
        console.error('Error:', error);
    }
}

createTestUser();
