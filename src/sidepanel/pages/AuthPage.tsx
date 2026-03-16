import { Box, Typography, Button, Stack, Fade } from '@mui/material';
import { LogIn, UserPlus, Shield } from 'lucide-react';
import { Sparkles } from 'lucide-react';

export default function AuthPage() {
    const handleLogin = () => {
        chrome.tabs.create({ url: 'https://crawlpilot.tech/login' });
    };

    const handleSignup = () => {
        chrome.tabs.create({ url: 'https://crawlpilot.tech/signup' });
    };

    return (
        <Fade in={true} timeout={800}>
            <Box sx={{
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                bgcolor: 'transparent',
                overflow: 'hidden',
                position: 'relative',
                p: 4
            }}>
                {/* Background Decorators */}
                <Box sx={{
                    position: 'absolute',
                    top: '-10%',
                    left: '-10%',
                    width: '40vw',
                    height: '40vw',
                    background: 'radial-gradient(circle, rgba(37,99,235,0.1) 0%, transparent 70%)',
                    borderRadius: '50%',
                    filter: 'blur(40px)',
                    zIndex: -1
                }} />

                <Box sx={{
                    position: 'absolute',
                    bottom: '-10%',
                    right: '-10%',
                    width: '40vw',
                    height: '40vw',
                    background: 'radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)',
                    borderRadius: '50%',
                    filter: 'blur(40px)',
                    zIndex: -1
                }} />

                {/* Logo & Header */}
                <Box sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    mb: 4,
                    textAlign: 'center'
                }}>
                    <Box sx={{
                        p: 2,
                        borderRadius: 4,
                        background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.2) 0%, rgba(96, 165, 250, 0.2) 100%)',
                        mb: 3,
                        boxShadow: '0 8px 32px -8px rgba(37, 99, 235, 0.5)',
                        border: '1px solid rgba(255,255,255,0.1)'
                    }}>
                        <Sparkles className="w-10 h-10 text-blue-500" />
                    </Box>
                    <Typography variant="h4" component="h1" fontWeight="800" gutterBottom sx={{
                        background: 'linear-gradient(to right, #60A5FA, #A78BFA)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent'
                    }}>
                        Crawl Pilot
                    </Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 280 }}>
                        Your intelligent web crawling companion. Sign in to sync your extractions and unlock premium features.
                    </Typography>
                </Box>

                {/* Actions */}
                <Stack spacing={2} sx={{ width: '100%', maxWidth: 320 }}>
                    <Button
                        fullWidth
                        variant="contained"
                        size="large"
                        startIcon={<LogIn size={18} />}
                        onClick={handleLogin}
                        sx={{
                            py: 1.5,
                            borderRadius: 3,
                            fontWeight: 700,
                            textTransform: 'none',
                            fontSize: '1rem',
                            background: 'linear-gradient(135deg, #2563EB 0%, #4F46E5 100%)',
                            boxShadow: '0 4px 14px 0 rgba(37, 99, 235, 0.39)',
                            '&:hover': {
                                background: 'linear-gradient(135deg, #1D4ED8 0%, #4338CA 100%)',
                                transform: 'translateY(-2px)',
                                boxShadow: '0 6px 20px rgba(37, 99, 235, 0.23)'
                            },
                        }}
                    >
                        Log In
                    </Button>

                    <Button
                        fullWidth
                        variant="outlined"
                        size="large"
                        startIcon={<UserPlus size={18} />}
                        onClick={handleSignup}
                        sx={{
                            py: 1.5,
                            borderRadius: 3,
                            fontWeight: 600,
                            textTransform: 'none',
                            fontSize: '1rem',
                            borderColor: 'rgba(255,255,255,0.2)',
                            color: 'text.primary',
                            bgcolor: 'rgba(255,255,255,0.03)',
                            backdropFilter: 'blur(10px)',
                            '&:hover': {
                                borderColor: 'primary.main',
                                bgcolor: 'rgba(37, 99, 235, 0.1)',
                            }
                        }}
                    >
                        Create Account
                    </Button>
                </Stack>

                {/* Security Badge */}
                <Box sx={{ mt: 6, display: 'flex', alignItems: 'center', gap: 1, color: 'text.disabled' }}>
                    <Shield size={14} />
                    <Typography variant="caption">
                        Secure authentication via Firebase
                    </Typography>
                </Box>
            </Box>
        </Fade>
    );
}
