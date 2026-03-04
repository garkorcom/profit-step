const fs = require('fs');
const path = require('path');

const targetPath = path.resolve('/Users/denysharbuzov/Projects/profit-step/src/pages/crm/UnifiedCockpitPage.tsx');
let content = fs.readFileSync(targetPath, 'utf8');

// 1. Wrap Block B2: Metadata in Accordion
const metaStartIdx = content.indexOf('{/* Block B2: Metadata — Creator, Time */}');
const metaEndIdx = content.indexOf('<Divider sx={{ my: 2 }} />', metaStartIdx);
if (metaStartIdx !== -1 && metaEndIdx !== -1) {
    const metaBlock = content.substring(metaStartIdx, metaEndIdx);

    // Replace <Typography variant="subtitle2" color="text.secondary" gutterBottom>
    //                            📋 Информация
    //                        </Typography>
    // with Accordion layout
    const newMetaBlock = `
                            {/* Block B2: Metadata — Creator, Time */}
                            <Accordion disableGutters variant="outlined" sx={{ mb: 2, '&:before': { display: 'none' }, borderRadius: 1 }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                    <Typography variant="subtitle2" color="text.secondary">
                                        📋 Информация
                                    </Typography>
                                </AccordionSummary>
                                <AccordionDetails>
${metaBlock
            .replace('{/* Block B2: Metadata — Creator, Time */}', '')
            .replace(/<Typography variant="subtitle2" color="text\.secondary" gutterBottom>\s*📋 Информация\s*<\/Typography>/g, '')}
                                </AccordionDetails>
                            </Accordion>
`;
    content = content.replace(metaBlock, newMetaBlock);
}

// 2. Wrap Block B3: Planning in Accordion
const planStartIdx = content.indexOf('{/* Block B3: Planning — Duration, Start, End */}');
const planEndIdx = content.indexOf('<Divider sx={{ my: 2 }} />', planStartIdx);
if (planStartIdx !== -1 && planEndIdx !== -1) {
    const planBlock = content.substring(planStartIdx, planEndIdx);

    const newPlanBlock = `
                            {/* Block B3: Planning — Duration, Start, End */}
                            <Accordion defaultExpanded={!isMobile} disableGutters variant="outlined" sx={{ mb: 2, '&:before': { display: 'none' }, borderRadius: 1 }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                    <Typography variant="subtitle2" color="text.secondary">
                                        📅 Планирование
                                    </Typography>
                                </AccordionSummary>
                                <AccordionDetails>
${planBlock
            .replace('{/* Block B3: Planning — Duration, Start, End */}', '')
            .replace(/<Typography variant="subtitle2" color="text\.secondary" gutterBottom>\s*📅 Планирование\s*<\/Typography>/g, '')}
                                </AccordionDetails>
                            </Accordion>
`;
    content = content.replace(planBlock, newPlanBlock);
}

// 3. Wrap Block C & D: Priority and Finance in one "Settings" Accordion, OR just leave them.
// "Priority" and "Finance" are small. Let's wrap both into a "Настройки" (Settings) Accordion.
const prioStartIdx = content.indexOf('{/* Block C: Priority */}');
const financeEndIdx = content.indexOf('</Paper>', prioStartIdx);
if (prioStartIdx !== -1 && financeEndIdx !== -1) {
    const prioFinBlock = content.substring(prioStartIdx, financeEndIdx);

    const newPrioFinBlock = `
                            {/* Block C & D: Settings */}
                            <Accordion disableGutters variant="outlined" sx={{ mb: 2, '&:before': { display: 'none' }, borderRadius: 1 }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                    <Typography variant="subtitle2" color="text.secondary">
                                        ⚙️ Приоритет и Финансы
                                    </Typography>
                                </AccordionSummary>
                                <AccordionDetails>
${prioFinBlock
            .replace(/<Divider sx={{ my: 2 }} \/>/g, '')}
                                </AccordionDetails>
                            </Accordion>
`;
    content = content.replace(prioFinBlock, newPrioFinBlock);
}

fs.writeFileSync(targetPath, content, 'utf8');
console.log("Accordion wrapping successful.");
