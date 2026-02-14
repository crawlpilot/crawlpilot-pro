import { ReactNode } from 'react';
import { Box, Paper, Typography, Stepper, Step, StepLabel, Button, Alert, StepConnector, stepConnectorClasses, styled } from '@mui/material';
import { ChevronLeft, Zap, AlertCircle, Check } from 'lucide-react';
import { IconButton } from '@mui/material';
import { useTabSync } from '../../hooks/useTabSync';

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
    children: ReactNode;
}

export function WizardLayout({
    title,
    subtitle,
    currentStep,
    totalSteps,
    onBack,
    children
}: WizardLayoutProps) {
    const activeStep = currentStep - 1;
    const { isTabConnected, isConnecting, connectTab } = useTabSync();

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default', overflow: 'hidden' }}>
            {/* Header Area */}
            <Paper
                elevation={0}
                sx={{
                    p: 2.5,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                    zIndex: 10,
                    background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
                    backdropFilter: 'blur(10px)'
                }}
            >
                {/* Connection Status Banner */}
                {!isTabConnected && (
                    <Alert
                        severity="warning"
                        variant="filled"
                        icon={<AlertCircle size={18} />}
                        sx={{
                            mb: 2.5,
                            borderRadius: 3,
                            bgcolor: 'rgba(255, 167, 38, 0.05)',
                            border: '1px solid rgba(255, 167, 38, 0.15)',
                            color: '#ffa726',
                            '& .MuiAlert-icon': { color: '#ffa726' },
                            py: 0.5
                        }}
                        action={
                            <Button
                                color="inherit"
                                size="small"
                                variant="outlined"
                                onClick={connectTab}
                                disabled={isConnecting}
                                startIcon={isConnecting ? null : <Zap size={14} />}
                                sx={{
                                    textTransform: 'none',
                                    borderWidth: '1.5px !important',
                                    fontWeight: 'bold',
                                    borderRadius: 2,
                                    px: 2
                                }}
                            >
                                {isConnecting ? 'Connecting...' : 'Connect to Tab'}
                            </Button>
                        }
                    >
                        <Typography variant="caption" sx={{ fontWeight: 'bold', fontSize: '0.75rem' }}>
                            Disconnected from current tab
                        </Typography>
                    </Alert>
                )}

                {/* Navigation & Title */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
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
            <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
                <div className="animate-fade-in-up">
                    {children}
                </div>
            </Box>
        </Box>
    );
}
