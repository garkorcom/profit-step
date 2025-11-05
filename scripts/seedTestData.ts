/**
 * QA Test Data Seeding Script
 * Генерирует полный набор тестовых данных для всех коллекций
 *
 * Usage:
 *   npm run seed:test -- --companies=5 --users=10
 *   npm run seed:test -- --clean  (удаляет все тестовые данные)
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { faker } from '@faker-js/faker';

// Initialize Firebase Admin
const app = initializeApp();
const db = getFirestore(app);

// ============================================================================
// Configuration
// ============================================================================

interface SeedConfig {
  companies: number;
  usersPerCompany: number;
  activityEventsPerUser: number;
  invitationsPerCompany: number;
  daysOfHistory: number;
}

const DEFAULT_CONFIG: SeedConfig = {
  companies: 5,
  usersPerCompany: 10,
  activityEventsPerUser: 20,
  invitationsPerCompany: 5,
  daysOfHistory: 30,
};

// ============================================================================
// Data Generators
// ============================================================================

/**
 * Генерирует фейковую компанию
 */
function generateCompany(index: number) {
  const companyName = faker.company.name();
  return {
    id: `test_company_${index}`,
    name: companyName,
    createdAt: Timestamp.fromDate(faker.date.past({ years: 2 })),
    subscription: {
      plan: faker.helpers.arrayElement(['basic', 'pro', 'enterprise']),
      status: 'active',
      startDate: Timestamp.fromDate(faker.date.past({ years: 1 })),
    },
    settings: {
      timezone: 'Europe/Kiev',
      language: 'uk',
    },
    metadata: {
      industry: faker.company.buzzNoun(),
      size: faker.helpers.arrayElement(['1-10', '11-50', '51-200', '200+']),
    },
  };
}

/**
 * Генерирует фейкового пользователя
 */
function generateUser(companyId: string, index: number) {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const email = `test.user.${companyId}.${index}@example.com`;

  return {
    id: `test_user_${companyId}_${index}`,
    email,
    firstName,
    lastName,
    displayName: `${firstName} ${lastName}`,
    companyId,
    role: faker.helpers.arrayElement(['user', 'manager', 'admin']),
    status: faker.helpers.arrayElement(['active', 'inactive', 'pending']),
    createdAt: Timestamp.fromDate(faker.date.past({ years: 1 })),
    lastLoginAt: Timestamp.fromDate(faker.date.recent({ days: 7 })),
    profileCompleted: faker.datatype.boolean(0.7), // 70% completed
  };
}

/**
 * Генерирует событие активности
 */
function generateActivityLog(
  userId: string,
  companyId: string,
  timestamp: Date
) {
  const actions = [
    { action: 'login', category: 'auth', metadata: {} },
    { action: 'logout', category: 'auth', metadata: {} },
    { action: 'profile_updated', category: 'profile', metadata: { fields: ['firstName', 'lastName'] } },
    { action: 'role_changed', category: 'admin', metadata: { oldRole: 'user', newRole: 'manager' } },
    { action: 'invitation_sent', category: 'team', metadata: { recipientEmail: faker.internet.email() } },
    { action: 'document_uploaded', category: 'content', metadata: { fileName: faker.system.fileName() } },
  ];

  const selectedAction = faker.helpers.arrayElement(actions);

  return {
    userId,
    companyId,
    action: selectedAction.action,
    category: selectedAction.category,
    timestamp: Timestamp.fromDate(timestamp),
    metadata: selectedAction.metadata,
    ipAddress: faker.internet.ip(),
    userAgent: faker.internet.userAgent(),
  };
}

/**
 * Генерирует приглашение
 */
function generateInvitation(companyId: string, index: number) {
  const email = `invited.${companyId}.${index}@example.com`;
  const statuses = ['pending', 'sent', 'bounced', 'accepted', 'failed'];
  const status = faker.helpers.arrayElement(statuses);

  return {
    id: `test_invitation_${companyId}_${index}`,
    email,
    companyId,
    invitedBy: `test_user_${companyId}_0`, // admin который пригласил
    role: faker.helpers.arrayElement(['user', 'manager']),
    status,
    createdAt: Timestamp.fromDate(faker.date.past({ days: 30 })),
    sentAt: status !== 'pending' ? Timestamp.fromDate(faker.date.recent({ days: 20 })) : null,
    expiresAt: Timestamp.fromDate(faker.date.future({ days: 7 })),
    brevoData: status !== 'pending' ? {
      messageId: faker.string.uuid(),
      templateId: 1,
    } : null,
  };
}

/**
 * Генерирует email event (для Brevo webhook simulation)
 */
function generateEmailEvent(invitationId: string, companyId: string) {
  const eventTypes = ['sent', 'delivered', 'opened', 'clicked', 'bounced', 'spam'];
  const eventType = faker.helpers.arrayElement(eventTypes);

  return {
    invitationId,
    companyId,
    event: eventType,
    timestamp: Timestamp.fromDate(faker.date.recent({ days: 15 })),
    messageId: faker.string.uuid(),
    email: `invited.${companyId}.${faker.number.int({ max: 10 })}@example.com`,
    metadata: {
      ip: faker.internet.ip(),
      userAgent: faker.internet.userAgent(),
    },
  };
}

/**
 * Генерирует метрики роста (для testing aggregation functions)
 */
function generateGrowthMetrics(date: Date) {
  return {
    date: Timestamp.fromDate(date),
    newUsers: faker.number.int({ min: 5, max: 50 }),
    newCompanies: faker.number.int({ min: 0, max: 5 }),
    totalUsers: faker.number.int({ min: 100, max: 5000 }),
    totalCompanies: faker.number.int({ min: 10, max: 500 }),
    metadata: {
      calculatedAt: Timestamp.now(),
    },
  };
}

/**
 * Генерирует метрики вовлеченности
 */
function generateEngagementMetrics(date: Date) {
  const dau = faker.number.int({ min: 50, max: 500 });
  const wau = faker.number.int({ min: 200, max: 1500 });
  const mau = faker.number.int({ min: 500, max: 5000 });

  return {
    date: Timestamp.fromDate(date),
    dau,
    wau,
    mau,
    stickiness: (dau / mau) * 100, // DAU/MAU ratio
    avgSessionDuration: faker.number.int({ min: 300, max: 3600 }), // seconds
    metadata: {
      calculatedAt: Timestamp.now(),
    },
  };
}

/**
 * Генерирует user activation record
 */
function generateUserActivation(userId: string, companyId: string) {
  const steps = ['signupCompleted', 'emailVerified', 'profileCompleted', 'firstAction'];
  const completedSteps = faker.number.int({ min: 1, max: 4 });

  const activation: any = {
    userId,
    companyId,
    signupCompleted: true,
    signupCompletedAt: Timestamp.fromDate(faker.date.past({ days: 30 })),
  };

  if (completedSteps >= 2) {
    activation.emailVerified = true;
    activation.emailVerifiedAt = Timestamp.fromDate(faker.date.recent({ days: 25 }));
  }

  if (completedSteps >= 3) {
    activation.profileCompleted = true;
    activation.profileCompletedAt = Timestamp.fromDate(faker.date.recent({ days: 20 }));
  }

  if (completedSteps >= 4) {
    activation.firstAction = true;
    activation.firstActionAt = Timestamp.fromDate(faker.date.recent({ days: 15 }));
  }

  return activation;
}

/**
 * Генерирует cost report (mock data для BigQuery)
 */
function generateCostReport(date: Date) {
  return {
    date: Timestamp.fromDate(date),
    totalCost: faker.number.float({ min: 10, max: 200, multipleOf: 0.01 }),
    breakdown: {
      firestore: faker.number.float({ min: 5, max: 50, multipleOf: 0.01 }),
      cloudFunctions: faker.number.float({ min: 3, max: 30, multipleOf: 0.01 }),
      storage: faker.number.float({ min: 2, max: 20, multipleOf: 0.01 }),
      brevo: faker.number.float({ min: 1, max: 10, multipleOf: 0.01 }),
    },
    metadata: {
      syncedAt: Timestamp.now(),
      source: 'test_seeded',
    },
  };
}

/**
 * Генерирует system error
 */
function generateSystemError() {
  const errorTypes = ['function_timeout', 'permission_denied', 'network_error', 'validation_error'];
  const functions = ['aggregateGrowthMetrics', 'brevoWebhookHandler', 'logUserActivity'];

  return {
    timestamp: Timestamp.fromDate(faker.date.recent({ days: 7 })),
    errorType: faker.helpers.arrayElement(errorTypes),
    functionName: faker.helpers.arrayElement(functions),
    message: faker.lorem.sentence(),
    stack: faker.lorem.lines(5),
    metadata: {
      userId: faker.string.uuid(),
      severity: faker.helpers.arrayElement(['low', 'medium', 'high', 'critical']),
    },
  };
}

// ============================================================================
// Main Seeding Logic
// ============================================================================

async function seedDatabase(config: SeedConfig) {
  console.log('🌱 Starting test data seeding...');
  console.log('Configuration:', config);

  const batch = db.batch();
  let operationCount = 0;

  // Track created IDs
  const createdCompanyIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdInvitationIds: string[] = [];

  // 1. Seed Companies
  console.log('\n📦 Seeding companies...');
  for (let i = 0; i < config.companies; i++) {
    const company = generateCompany(i);
    const ref = db.collection('companies').doc(company.id);
    batch.set(ref, company);
    createdCompanyIds.push(company.id);
    operationCount++;

    // Commit batch if needed (Firestore limit: 500 operations)
    if (operationCount >= 450) {
      await batch.commit();
      console.log(`  ✓ Committed ${operationCount} operations`);
      operationCount = 0;
    }
  }
  console.log(`  ✓ Created ${config.companies} companies`);

  // 2. Seed Users
  console.log('\n👥 Seeding users...');
  for (const companyId of createdCompanyIds) {
    for (let i = 0; i < config.usersPerCompany; i++) {
      const user = generateUser(companyId, i);
      const ref = db.collection('users').doc(user.id);
      batch.set(ref, user);
      createdUserIds.push(user.id);
      operationCount++;

      if (operationCount >= 450) {
        await batch.commit();
        console.log(`  ✓ Committed ${operationCount} operations`);
        operationCount = 0;
      }
    }
  }
  console.log(`  ✓ Created ${createdUserIds.length} users`);

  // 3. Seed Activity Logs
  console.log('\n📊 Seeding activity logs...');
  let totalActivityEvents = 0;
  for (const userId of createdUserIds) {
    const user = await db.collection('users').doc(userId).get();
    const userData = user.data();
    if (!userData) continue;

    for (let i = 0; i < config.activityEventsPerUser; i++) {
      const daysAgo = faker.number.int({ min: 0, max: config.daysOfHistory });
      const timestamp = new Date();
      timestamp.setDate(timestamp.getDate() - daysAgo);

      const activity = generateActivityLog(userId, userData.companyId, timestamp);
      const ref = db.collection('activityLog').doc();
      batch.set(ref, activity);
      totalActivityEvents++;
      operationCount++;

      if (operationCount >= 450) {
        await batch.commit();
        console.log(`  ✓ Committed ${operationCount} operations`);
        operationCount = 0;
      }
    }
  }
  console.log(`  ✓ Created ${totalActivityEvents} activity events`);

  // 4. Seed Invitations
  console.log('\n✉️  Seeding invitations...');
  for (const companyId of createdCompanyIds) {
    for (let i = 0; i < config.invitationsPerCompany; i++) {
      const invitation = generateInvitation(companyId, i);
      const ref = db.collection('invitations').doc(invitation.id);
      batch.set(ref, invitation);
      createdInvitationIds.push(invitation.id);
      operationCount++;

      if (operationCount >= 450) {
        await batch.commit();
        console.log(`  ✓ Committed ${operationCount} operations`);
        operationCount = 0;
      }
    }
  }
  console.log(`  ✓ Created ${createdInvitationIds.length} invitations`);

  // 5. Seed Email Events
  console.log('\n📧 Seeding email events...');
  let totalEmailEvents = 0;
  for (const invitationId of createdInvitationIds) {
    const invitation = await db.collection('invitations').doc(invitationId).get();
    const invitationData = invitation.data();
    if (!invitationData) continue;

    // Generate 1-3 events per invitation
    const eventCount = faker.number.int({ min: 1, max: 3 });
    for (let i = 0; i < eventCount; i++) {
      const emailEvent = generateEmailEvent(invitationId, invitationData.companyId);
      const ref = db.collection('emailEvents').doc();
      batch.set(ref, emailEvent);
      totalEmailEvents++;
      operationCount++;

      if (operationCount >= 450) {
        await batch.commit();
        console.log(`  ✓ Committed ${operationCount} operations`);
        operationCount = 0;
      }
    }
  }
  console.log(`  ✓ Created ${totalEmailEvents} email events`);

  // 6. Seed User Activation Records
  console.log('\n🎯 Seeding user activation records...');
  for (const userId of createdUserIds) {
    const user = await db.collection('users').doc(userId).get();
    const userData = user.data();
    if (!userData) continue;

    const activation = generateUserActivation(userId, userData.companyId);
    const ref = db.collection('userActivation').doc(userId);
    batch.set(ref, activation);
    operationCount++;

    if (operationCount >= 450) {
      await batch.commit();
      console.log(`  ✓ Committed ${operationCount} operations`);
      operationCount = 0;
    }
  }
  console.log(`  ✓ Created ${createdUserIds.length} activation records`);

  // 7. Seed Growth Metrics (daily for last N days)
  console.log('\n📈 Seeding growth metrics...');
  for (let i = 0; i < config.daysOfHistory; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);

    const metrics = generateGrowthMetrics(date);
    const ref = db.collection('growthMetrics').doc(date.toISOString().split('T')[0]);
    batch.set(ref, metrics);
    operationCount++;

    if (operationCount >= 450) {
      await batch.commit();
      console.log(`  ✓ Committed ${operationCount} operations`);
      operationCount = 0;
    }
  }
  console.log(`  ✓ Created ${config.daysOfHistory} growth metric records`);

  // 8. Seed Engagement Metrics
  console.log('\n💡 Seeding engagement metrics...');
  for (let i = 0; i < config.daysOfHistory; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);

    const metrics = generateEngagementMetrics(date);
    const ref = db.collection('engagementMetrics').doc(date.toISOString().split('T')[0]);
    batch.set(ref, metrics);
    operationCount++;

    if (operationCount >= 450) {
      await batch.commit();
      console.log(`  ✓ Committed ${operationCount} operations`);
      operationCount = 0;
    }
  }
  console.log(`  ✓ Created ${config.daysOfHistory} engagement metric records`);

  // 9. Seed Cost Reports
  console.log('\n💰 Seeding cost reports...');
  for (let i = 0; i < config.daysOfHistory; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);

    const report = generateCostReport(date);
    const ref = db.collection('costReports').doc(date.toISOString().split('T')[0]);
    batch.set(ref, report);
    operationCount++;

    if (operationCount >= 450) {
      await batch.commit();
      console.log(`  ✓ Committed ${operationCount} operations`);
      operationCount = 0;
    }
  }
  console.log(`  ✓ Created ${config.daysOfHistory} cost reports`);

  // 10. Seed System Errors (random amount)
  console.log('\n⚠️  Seeding system errors...');
  const errorCount = faker.number.int({ min: 10, max: 50 });
  for (let i = 0; i < errorCount; i++) {
    const error = generateSystemError();
    const ref = db.collection('systemErrors').doc();
    batch.set(ref, error);
    operationCount++;

    if (operationCount >= 450) {
      await batch.commit();
      console.log(`  ✓ Committed ${operationCount} operations`);
      operationCount = 0;
    }
  }
  console.log(`  ✓ Created ${errorCount} system errors`);

  // Final commit
  if (operationCount > 0) {
    await batch.commit();
    console.log(`  ✓ Committed final ${operationCount} operations`);
  }

  console.log('\n✅ Test data seeding completed successfully!');
  console.log('\n📊 Summary:');
  console.log(`  - Companies: ${config.companies}`);
  console.log(`  - Users: ${createdUserIds.length}`);
  console.log(`  - Activity Events: ${totalActivityEvents}`);
  console.log(`  - Invitations: ${createdInvitationIds.length}`);
  console.log(`  - Email Events: ${totalEmailEvents}`);
  console.log(`  - Activation Records: ${createdUserIds.length}`);
  console.log(`  - Growth Metrics: ${config.daysOfHistory}`);
  console.log(`  - Engagement Metrics: ${config.daysOfHistory}`);
  console.log(`  - Cost Reports: ${config.daysOfHistory}`);
  console.log(`  - System Errors: ${errorCount}`);
}

/**
 * Очистка тестовых данных
 */
async function cleanTestData() {
  console.log('🧹 Cleaning test data...');

  const collections = [
    'companies',
    'users',
    'activityLog',
    'invitations',
    'emailEvents',
    'userActivation',
    'growthMetrics',
    'engagementMetrics',
    'costReports',
    'systemErrors',
  ];

  for (const collectionName of collections) {
    console.log(`  Cleaning ${collectionName}...`);
    const snapshot = await db.collection(collectionName)
      .where('__name__', '>=', 'test_')
      .where('__name__', '<', 'test_\uf8ff')
      .get();

    const batch = db.batch();
    let count = 0;

    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
      count++;
    });

    if (count > 0) {
      await batch.commit();
      console.log(`    ✓ Deleted ${count} documents`);
    }
  }

  console.log('✅ Test data cleaned!');
}

// ============================================================================
// CLI
// ============================================================================

const args = process.argv.slice(2);
const config = { ...DEFAULT_CONFIG };

if (args.includes('--clean')) {
  cleanTestData().then(() => process.exit(0));
} else {
  // Parse arguments
  args.forEach((arg) => {
    if (arg.startsWith('--companies=')) {
      config.companies = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--users=')) {
      config.usersPerCompany = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--days=')) {
      config.daysOfHistory = parseInt(arg.split('=')[1], 10);
    }
  });

  seedDatabase(config).then(() => process.exit(0));
}
