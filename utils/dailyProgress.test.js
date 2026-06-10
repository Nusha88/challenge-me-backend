const assert = require('assert');
const {
  buildDailyProgress,
  getMissionProgressForDate,
  isHabitScheduledOnLocalDate
} = require('./dailyProgress');

const userId = 'user-1';

function makeChallenge({ startDate, endDate, frequency = 'daily', completedDays = [] }) {
  return {
    _id: 'challenge-1',
    startDate,
    endDate,
    frequency,
    participants: [{ userId, completedDays }]
  };
}

function runTests() {
  const startDate = '2026-06-01';
  const endDate = '2026-06-30';

  // everyOtherDay: day 0 (Jun 1) is on, day 1 (Jun 2) is off
  assert.strictEqual(
    isHabitScheduledOnLocalDate(
      makeChallenge({ startDate, endDate, frequency: 'everyOtherDay' }),
      '2026-06-01'
    ),
    true
  );
  assert.strictEqual(
    isHabitScheduledOnLocalDate(
      makeChallenge({ startDate, endDate, frequency: 'everyOtherDay' }),
      '2026-06-02'
    ),
    false
  );

  const everyOtherDayChallenge = makeChallenge({
    startDate,
    endDate,
    frequency: 'everyOtherDay',
    completedDays: []
  });

  const offDayProgress = buildDailyProgress({
    checklist: null,
    challenges: [everyOtherDayChallenge],
    userId,
    localDate: '2026-06-02',
    timeZone: 'UTC'
  });
  assert.strictEqual(offDayProgress.isEmpty, true, 'off-day everyOtherDay should be empty');

  const onDayIncomplete = buildDailyProgress({
    checklist: null,
    challenges: [everyOtherDayChallenge],
    userId,
    localDate: '2026-06-01',
    timeZone: 'UTC'
  });
  assert.strictEqual(onDayIncomplete.isEmpty, false);
  assert.strictEqual(onDayIncomplete.isComplete, false);

  const dailyChallenge = makeChallenge({
    startDate,
    endDate,
    frequency: 'daily',
    completedDays: ['2026-06-03']
  });

  const allMissionsDone = buildDailyProgress({
    checklist: { tasks: [{ title: 'Step 1', done: true }, { title: 'Step 2', done: true }] },
    challenges: [dailyChallenge],
    userId,
    localDate: '2026-06-03',
    timeZone: 'UTC'
  });
  assert.strictEqual(allMissionsDone.isComplete, true);

  const missionsDoneChecklistPending = buildDailyProgress({
    checklist: { tasks: [{ title: 'Step 1', done: true }, { title: 'Step 2', done: false }] },
    challenges: [dailyChallenge],
    userId,
    localDate: '2026-06-03',
    timeZone: 'UTC'
  });
  assert.strictEqual(missionsDoneChecklistPending.isComplete, false);

  const missionProgress = getMissionProgressForDate(
    [makeChallenge({ startDate, endDate, frequency: 'daily', completedDays: ['2026-06-04'] })],
    userId,
    '2026-06-04'
  );
  assert.strictEqual(missionProgress.total, 1);
  assert.strictEqual(missionProgress.completed, 1);

  console.log('dailyProgress.test.js: all tests passed');
}

runTests();
