import { ReactNode } from 'react';
import { Box, Paper, Typography, Stepper, Step, StepLabel, StepConnector, stepConnectorClasses, styled } from '@mui/material';
import { ChevronLeft, Check } from 'lucide-react';
import { IconButton } from '@mui/material';

// Custom Styled Connector
const QontoConnector = styled(StepConnector)(() => ({
    [`&.${stepConnectorClasses.alternativeLabel}`]: {
        top: 10,
        left: 'calc(-50% + 16px)',
        right: 'calc(50% + 16px)',
    },
    [`&.${stepConnectorClasses.active}`]: {
        [`& .${stepConnectorClasses.line}`]: {
            borderColor: '#06b6d4',
            borderWidth: 2,
        },
    },
    [`&.${stepConnectorClasses.completed}`]: {
        [`& .${stepConnectorClasses.line}`]: {
            borderColor: '#06b6d4',
            borderWidth: 2,
        },
    },
    [`& .${stepConnectorClasses.line}`]: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderTopWidth: 2,
        borderRadius: 1,
    },
}));

// Custom Step Icon
const QontoStepIconRoot = styled('div')<{ ownerState: { active?: boolean; completed?: boolean } }>(
    ({ ownerState }) => ({
        color: 'rgba(255, 255, 255, 0.2)',
        display: 'flex',
        height: 22,
        alignItems: 'center',
        ...(ownerState.active && {
            color: '#06b6d4',
        }),
        '& .QontoStepIcon-completedIcon': {
            color: '#06b6d4',
            zIndex: 1,
            fontSize: 18,
        },
        '& .QontoStepIcon-circle': {
            width: 10,
            height: 10,
            borderRadius: '50%',
            backgroundColor: 'currentColor',
            boxShadow: ownerState.active ? '0 0 10px #06b6d4' : 'none',
        },
    }),
);

function QontoStepIcon(props: any) {
    const { active, completed, className } = props;

    return (
        <QontoStepIconRoot ownerState={{ active, completed }} className={className}>
            {completed ? (
                <Check className="QontoStepIcon-completedIcon" size={16} strokeWidth={4} />
            ) : (
                <div className="QontoStepIcon-circle" />
            )}
        </QontoStepIconRoot>
    );
}

interface WizardLayoutProps {
    title: string;
    subtitle?: string;
    currentStep: number;
    totalSteps: number;
    onBack?: () => void;
    isLoading?: boolean;
    children: ReactNode;
}

export function WizardLayout({
    title,
    subtitle,
    currentStep,
    totalSteps,
    onBack,
    isLoading = false,
    children
}: WizardLayoutProps) {
    const activeStep = currentStep - 1;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default', overflow: 'hidden' }}>
            {/* Header Area */}
            <Paper
                elevation={0}
                sx={{
                    p: 2,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                    zIndex: 10,
                    position: 'relative',
                    overflow: 'hidden',
                    background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
                    backdropFilter: 'blur(10px)'
                }}
            >
                {/* YouTube-style loading bar */}
                {isLoading && (
                    <Box sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: '3px',
                        bgcolor: 'transparent',
                        overflow: 'hidden',
                        zIndex: 20,
                        '&::after': {
                            content: '""',
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            height: '100%',
                            width: '40%',
                            background: 'linear-gradient(90deg, transparent, #22D3EE, #06b6d4, transparent)',
                            animation: 'wizardLoadingSlide 1.4s ease-in-out infinite',
                        },
                        '@keyframes wizardLoadingSlide': {
                            '0%': { transform: 'translateX(-150%)' },
                            '100%': { transform: 'translateX(350%)' },
                        }
                    }} />
                )}
                {/* Navigation & Title */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                    {onBack && (
                        <IconButton
                            onClick={onBack}
                            size="small"
                            sx={{
                                color: 'text.secondary',
                                bgcolor: 'rgba(255,255,255,0.03)',
                                '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', color: 'white' }
                            }}
                        >
                            <ChevronLeft size={20} />
                        </IconButton>
                    )}
                    <Box>
                        <Typography variant="h6" sx={{ color: 'text.primary', fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.01em' }}>
                            {title}
                        </Typography>
                        {subtitle && (
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500, mt: 0.5, display: 'block', opacity: 0.8 }}>
                                {subtitle}
                            </Typography>
                        )}
                    </Box>
                </Box>

                {/* Stepper */}
                <Stepper
                    activeStep={activeStep}
                    alternativeLabel
                    connector={<QontoConnector />}
                    sx={{
                        '& .MuiStepLabel-label': {
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            mt: 1,
                            color: 'rgba(255,255,255,0.3)',
                            '&.Mui-active': { color: '#06b6d4' },
                            '&.Mui-completed': { color: 'rgba(255,255,255,0.5)' }
                        }
                    }}
                >
                    {Array.from({ length: totalSteps }).map((_, index) => (
                        <Step key={index}>
                            <StepLabel StepIconComponent={QontoStepIcon} />
                        </Step>
                    ))}
                </Stepper>
            </Paper>

            {/* Content Area */}
            <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5 }}>
                <div className="animate-fade-in-up">
                    {children}
                </div>
            </Box>
        </Box>
    );
}
