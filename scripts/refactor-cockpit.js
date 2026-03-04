const fs = require('fs');
const path = require('path');

const targetPath = path.resolve('/Users/denysharbuzov/Projects/profit-step/src/pages/crm/UnifiedCockpitPage.tsx');
let content = fs.readFileSync(targetPath, 'utf8');

// 1. Add useMediaQuery and useTheme to imports
content = content.replace(
    'Accordion, AccordionSummary, AccordionDetails',
    'Accordion, AccordionSummary, AccordionDetails,\n    useMediaQuery, useTheme'
);

// 2. Add theming hooks inside the component
const componentStart = 'const UnifiedCockpitPage: React.FC = () => {\n';
const hooksToInsert = `    const theme = useTheme();\n    const isMobile = useMediaQuery(theme.breakpoints.down('md'));\n`;
content = content.replace(componentStart, componentStart + hooksToInsert);

// 3. Sticky Bottom Action Bar for Mobile
const bottomActionBar = `
            {/* ═══════════════════════════════════════════════════════════ */}
            {/* MOBILE: STICKY BOTTOM ACTION BAR */}
            {/* ═══════════════════════════════════════════════════════════ */}
            {isMobile && (
                <Paper 
                    elevation={8} 
                    sx={{ 
                        position: 'sticky', 
                        bottom: 0, 
                        zIndex: 100, 
                        p: 2, 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        bgcolor: 'background.paper',
                        paddingBottom: 'env(safe-area-inset-bottom)'
                    }}
                >
                    <Button
                        variant={isTimerRunningForThisTask ? 'contained' : 'outlined'}
                        color={isTimerRunningForThisTask ? 'error' : 'success'}
                        startIcon={isTimerRunningForThisTask ? <StopIcon /> : <PlayIcon />}
                        onClick={handleTimerToggle}
                        fullWidth
                        size="large"
                        sx={{
                            animation: isTimerRunningForThisTask ? 'pulse 1.5s infinite' : 'none',
                        }}
                    >
                        {isTimerRunningForThisTask ? formatTime(timerSeconds) : 'Start Work'}
                     </Button>
                </Paper>
            )}
        </Box>
    );
};
`;
// Replace the EOF
content = content.replace('        </Box>\n    );\n};\n\nexport default UnifiedCockpitPage;', bottomActionBar + '\nexport default UnifiedCockpitPage;');


// 4. Moving `Block A: Client` to Left Column
const blockAStartIdx = content.indexOf('{/* Block A: Client */}');
const blockAEndIdx = content.indexOf('{/* Block B: Team */}');
const blockAText = content.substring(blockAStartIdx, blockAEndIdx);

// Remove Block A from right column
content = content.replace(blockAText, '');

// Insert Block A into Left Column under Description
const descEnd = 'onChange={(e) => { setDescription(e.target.value); setHasChanges(true); }}\n                                sx={{ mb: 3 }}\n                            />';
content = content.replace(descEnd, descEnd + '\n\n                            <Divider sx={{ my: 2 }} />\n\n                            ' + blockAText.trim());


// 5. Moving `Checklist` and `Activity Tabs` to Right Column
const checklistStartIdx = content.indexOf('{/* Checklist */}');
const endOfActivityTabs = `                                        onContactAdded={(newContact: any) => {
                                            setContacts(prev => [...prev, newContact].sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')));
                                            if (newContact.id) {
                                                setLinkedContactIds(prev => [...prev, newContact.id!]);
                                                setHasChanges(true);
                                            }
                                        }}
                                    />
                                </Box>
                            )}
`;
const exactEndIdx = content.indexOf(endOfActivityTabs) + endOfActivityTabs.length;
const elementsToMove = content.substring(checklistStartIdx, exactEndIdx);

// Remove elements from Left Column
content = content.replace(elementsToMove, '');

// Insert them at the TOP of the Right Column Paper
const oldRightColumnPaperStart = '{/* RIGHT COLUMN: Control Panel (35%) */}\n                    <Box sx={{ flex: { xs: \'1 1 100%\', md: \'1 1 35%\' }, minWidth: 0 }}>\n                        <Paper sx={{ p: 3 }}>';

// Note we prepend the elements to move directly under the <Paper sx={{p:3}}> in the Right Column
const newRightColumnPaperStart = '{/* RIGHT COLUMN: Control Panel (45%) */}\n                    <Box sx={{ flex: { xs: \'1 1 100%\', md: \'1 1 45%\' }, minWidth: 0 }}>\n                        <Paper sx={{ p: 3 }}>\n' + elementsToMove + '\n                            <Divider sx={{ my: 2 }} />\n';

content = content.replace(oldRightColumnPaperStart, newRightColumnPaperStart);

// Now safely fix the left column flex value
content = content.replace(`flex: { xs: '1 1 100%', md: '1 1 65%' }`, `flex: { xs: '1 1 100%', md: '1 1 55%' }`);

// 6. Make Tabs horizontal scrollable on mobile
content = content.replace(
    '<Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}>',
    '<Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>'
);

fs.writeFileSync(targetPath, content, 'utf8');
console.log("Rewrite successful.");
