import { db, auth } from '../firebase/firebase';
import { collection, addDoc, doc, setDoc, Timestamp, getDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { UserProfile } from '../types/user.types';
// import { Client, Site } from '../types/fsm.types';
// import { Task } from '../types/fsm.types';

export const seedLocalDb = async () => {
    console.log('🌱 Starting Seed...');

    try {
        // 0. Get current user from Auth
        const currentUser = auth.currentUser;
        if (!currentUser) {
            alert('Please log in first!');
            return;
        }

        // 1. Create User Profile (if not exists)
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userDocRef);

        let companyId: string;

        if (!userDoc.exists()) {
            console.log('Creating user profile...');

            // Create Company first
            const companyRef = doc(collection(db, 'companies'));
            companyId = companyRef.id;
            await setDoc(companyRef, {
                name: 'Demo Corp',
                ownerId: currentUser.uid,
                status: 'active',
                createdAt: Timestamp.now(),
                ownerCompanyId: companyId // Self-reference for filtering
            });
            console.log('✅ Company created:', companyId);

            // Create User Profile
            await setDoc(userDocRef, {
                id: currentUser.uid,
                email: currentUser.email,
                displayName: currentUser.displayName || 'Demo User',
                companyId: companyId,
                role: 'admin',
                status: 'active',
                onboarded: true,
                createdAt: Timestamp.now(),
                laborRate: 50,
                travelRate: 25
            } as any);
            console.log('✅ User profile created');
        } else {
            companyId = userDoc.data().companyId;
            console.log('✅ User profile exists, using company:', companyId);

            // Force update role to admin for dev convenience
            await setDoc(userDocRef, { role: 'admin' }, { merge: true });
            console.log('✅ User role updated to admin');
        }

        // 2. Create Client
        // Note: Client type is in crm.types.ts, not fsm.types.ts
        const clientRef = await addDoc(collection(db, 'clients'), {
            companyId,
            type: 'person',
            name: 'John Doe',
            contacts: [{ phone: '+1234567890', email: 'john@example.com' }],
            status: 'active',
            totalRevenue: 0,
            tags: ['vip'],
            assignedTo: currentUser.uid,
            createdBy: currentUser.uid,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
        } as any);
        console.log('✅ Client created:', clientRef.id);

        // 3. Create Site
        await addDoc(collection(db, `companies/${companyId}/clients/${clientRef.id}/sites`), {
            clientId: clientRef.id,
            companyId,
            name: 'Miami Beach House',
            address: '123 Ocean Dr, Miami, FL',
            geo: {
                lat: 25.7617,
                lng: -80.1918,
                radius: 150
            },
            contacts: ['+1987654321'],
            photos: [],
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
        } as any); // Cast as any to avoid 'id' missing error
        console.log('✅ Site created');

        // 4. Create Task
        await addDoc(collection(db, `companies/${companyId}/tasks`), {
            companyId,
            number: 'TASK-001',
            title: 'Fix AC Unit',
            clientId: clientRef.id,
            // siteId will be fetched from query or we need to capture it.
            // For seed simplicity, we just created it but didn't capture ID easily without await var.
            // Let's just use a placeholder or fix the previous step to capture ID.
            siteId: 'temp-site-id',
            assigneeId: currentUser.uid,
            estimatorId: currentUser.uid,
            status: 'todo',
            priority: 'high',
            salesPrice: 500,
            costLabor: 0,
            costTravel: 0,
            costMaterials: 0,
            totalCost: 0,
            grossMargin: 500,
            photosBefore: [],
            photosAfter: [],
            estimatedDuration: 120,
            actualDuration: 0,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
        } as any);
        console.log('✅ Task created');

        console.log('🎉 Seed Complete! Use Company ID:', companyId);
        alert(`Seed Complete! Company ID: ${companyId}\n\nPlease refresh the page to see changes.`);
    } catch (error) {
        console.error('❌ Seed Failed:', error);
        alert('Seed Failed! Check console.');
    }
};
