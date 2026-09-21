const React = Spicetify.React;

function VisualizadorProConfig() {
    const canvasRef = React.useRef(null);
    const audioDataRef = React.useRef({ segments: [], beats: [], loudnessHistory: [] });
    
    // Colores dinámicos
    const colorBotRef = React.useRef({ r: 30, g: 215, b: 96 }); 
    const colorTopRef = React.useRef({ r: 255, g: 255, b: 255 });

    const [config, setConfig] = React.useState(() => {
        const saved = localStorage.getItem("viz_config");
        const defaultCfg = { 
            sensitivity: 1.0, friction: 0.85, tension: 0.08, 
            bars: 84, brightness: 150, delay: 0, 
            manual: false, hexBot: "#1db954", hexTop: "#ffffff",
            neon: true
        };
        try { return saved ? { ...defaultCfg, ...JSON.parse(saved) } : defaultCfg; } catch (e) { return defaultCfg; }
    });

    // --- HELPER: HEX TO RGB ---
    const hexToRgb = (hex) => {
        if (!hex) return null;
        hex = hex.replace('#', '');
        if (hex.length === 3) {
            hex = hex.split('').map(c => c + c).join('');
        }
        return {
            r: parseInt(hex.substring(0, 2), 16) || 0,
            g: parseInt(hex.substring(2, 4), 16) || 0,
            b: parseInt(hex.substring(4, 6), 16) || 0
        };
    };

    // --- EXTRACTOR DIRECTO DE COLOR DESDE LA IMAGEN DEL ÁLBUM (LOCAL / CANVAS) ---
    const extractVibrantColorFromImage = (imgUrl) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => {
                try {
                    const c = document.createElement("canvas");
                    const ctx = c.getContext("2d");
                    c.width = 36;
                    c.height = 36;
                    ctx.drawImage(img, 0, 0, 36, 36);
                    const data = ctx.getImageData(0, 0, 36, 36).data;
                    
                    let bestColor = null;
                    let maxScore = -1;
                    let avgR = 0, avgG = 0, avgB = 0, validCount = 0;

                    for (let i = 0; i < data.length; i += 4) {
                        const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
                        if (a < 128) continue;
                        
                        const max = Math.max(r, g, b), min = Math.min(r, g, b);
                        const l = (max + min) / (2 * 255);
                        const d = (max - min) / 255;
                        const s = l > 0.5 ? d / (2 - max/255 - min/255 || 1) : d / (max/255 + min/255 || 1);
                        
                        avgR += r; avgG += g; avgB += b; validCount++;

                        // Priorizar colores con saturación y luminosidad media (vibrantes)
                        if (l > 0.15 && l < 0.85) {
                            const score = s * 2.5 + (1 - Math.abs(l - 0.5));
                            if (score > maxScore) {
                                maxScore = score;
                                bestColor = { r, g, b };
                            }
                        }
                    }

                    if (bestColor) {
                        resolve(bestColor);
                    } else if (validCount > 0) {
                        resolve({ 
                            r: Math.round(avgR / validCount), 
                            g: Math.round(avgG / validCount), 
                            b: Math.round(avgB / validCount) 
                        });
                    } else {
                        resolve(null);
                    }
                } catch (e) {
                    resolve(null);
                }
            };
            img.onerror = () => resolve(null);
            img.src = imgUrl;
        });
    };

    // --- OBTENER COLOR DINÁMICO DEL ÁLBUM ---
    const colorApiFailedRef = React.useRef(false);

	const toImageUrl = (u) => {
		if (!u) return null;
		return u.startsWith("spotify:image:") ? "https://i.scdn.co/image/" + u.slice(14) : u;
	};

	const getCoverUrl = () => {
		const meta = Spicetify.Player.data?.item?.metadata || {};
		return toImageUrl(meta.image_xlarge_url || meta.image_large_url || meta.image_url);
	};

	const extractFromCover = (url) => new Promise((resolve) => {
		if (!url) return resolve(null);
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => {
			try {
				const S = 32;
				const c = document.createElement("canvas");
				c.width = c.height = S;
				const cx = c.getContext("2d", { willReadFrequently: true });
				cx.drawImage(img, 0, 0, S, S);
				const d = cx.getImageData(0, 0, S, S).data;

				let best = null, bestScore = -1;
				for (let i = 0; i < d.length; i += 4) {
					const r = d[i], g = d[i + 1], b = d[i + 2];
					const max = Math.max(r, g, b), min = Math.min(r, g, b);
					const sat = max === 0 ? 0 : (max - min) / max;
					const lum = (max + min) / 510;
					const score = sat * (1 - Math.abs(lum - 0.55) * 1.5);
					if (score > bestScore) { bestScore = score; best = { r, g, b }; }
				}
				resolve(bestScore > 0.05 ? best : null);
			} catch (e) { resolve(null); }
		};
		img.onerror = () => resolve(null);
		img.src = url;
	});

	const lighten = ({ r, g, b }, amount = 0.55) => ({
		r: Math.round(r + (255 - r) * amount),
		g: Math.round(g + (255 - g) * amount),
		b: Math.round(b + (255 - b) * amount)
	});

	const applyColor = (rgb) => {
		colorBotRef.current = rgb;
		colorTopRef.current = lighten(rgb);
	};

	const updateDynamicColor = async () => {
		if (config.manual) return;

		// 1) Portada: fiable, no depende de servidores de Spotify
		const fromCover = await extractFromCover(getCoverUrl());
		if (fromCover) { applyColor(fromCover); return; }

		// 2) API oficial, solo si la portada falló y la API no ha muerto ya
		const uri = Spicetify.Player.data?.item?.uri;
		if (uri && !colorApiFailedRef.current) {
			try {
				const colors = await Spicetify.colorExtractor(uri);
				const hex = colors?.VIBRANT || colors?.LIGHT_VIBRANT || colors?.PROMINENT || colors?.DARK_VIBRANT;
				if (hex && /^#?[0-9a-f]{6}$/i.test(hex.trim())) {
					applyColor(hexToRgb(hex.trim()));
					return;
				}
			} catch (e) {
				colorApiFailedRef.current = true; // no reintentar en esta sesión
			}
		}

		applyColor({ r: 30, g: 215, b: 96 });
	};

    // --- EFFECT: WATCH CONFIG CHANGES ---
    React.useEffect(() => {
        localStorage.setItem("viz_config", JSON.stringify(config));
        if (config.manual) {
            colorBotRef.current = hexToRgb(config.hexBot) || { r: 30, g: 215, b: 96 };
            colorTopRef.current = hexToRgb(config.hexTop) || { r: 255, g: 255, b: 255 };
        } else {
            updateDynamicColor();
        }
    }, [config]);

    const fetchAudioData = async () => {
        const item = Spicetify.Player.data?.item;
        if (!item) return;
        updateDynamicColor();
        try {
            const data = await Spicetify.getAudioData(item.uri);
            audioDataRef.current = data ? { segments: data.segments || [], beats: data.beats || [], loudnessHistory: [] } : { segments: [], beats: [], loudnessHistory: [] };
        } catch (e) { 
            audioDataRef.current = { segments: [], beats: [], loudnessHistory: [] }; 
        }
    };

    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d', { alpha: false });
        let animationId;
        let heights = new Array(200).fill(5), vels = new Array(200).fill(0);
        let lastT = performance.now(), internalClock = 0, lastP = 0;

        fetchAudioData();
        const onSongChange = () => fetchAudioData();
        Spicetify.Player.addEventListener("songchange", onSongChange);

        const renderLoop = (now) => {
            if (!canvas?.parentElement) { animationId = requestAnimationFrame(renderLoop); return; }
            
            if (canvas.width !== canvas.parentElement.clientWidth || canvas.height !== canvas.parentElement.clientHeight) {
                canvas.width = canvas.parentElement.clientWidth;
                canvas.height = canvas.parentElement.clientHeight;
            }

            ctx.fillStyle = '#121212';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const isPlaying = Spicetify.Player.isPlaying();
            const { segments, beats, loudnessHistory } = audioDataRef.current;
            const pProg = (Spicetify.Player.getProgress() || 0) / 1000;
            const dt = (now - lastT) / 1000;
            lastT = now;

            if (pProg !== lastP) { 
                internalClock += (pProg - internalClock) * 0.8; 
                lastP = pProg; 
            } else if (isPlaying) { 
                internalClock += dt; 
            }

            const exactTime = internalClock + (config.delay / 1000);
            const n = config.bars || 84;
            const mH = canvas.height * 0.75 * (config.sensitivity || 1.0);

            let pseudoFreqBands = new Array(16).fill(0);
            let avgNormalizedVolume = 0;

            if (isPlaying && segments && segments.length > 0) {
                const sIdx = segments.findIndex(s => exactTime >= s.start && exactTime < (s.start + s.duration));
                if (sIdx !== -1) {
                    const s1 = segments[sIdx], s2 = segments[sIdx + 1] || s1;
                    const ease = (1 - Math.cos(Math.max(0, Math.min(1, (exactTime - s1.start) / s1.duration)) * Math.PI)) / 2;
                    
                    loudnessHistory.push(s1.loudness_max);
                    if (loudnessHistory.length > 100) loudnessHistory.shift();
                    const avgLoudness = Math.max(...loudnessHistory, -20);
                    
                    avgNormalizedVolume = Math.pow(Math.max(0, (s1.loudness_max + 60) / (avgLoudness + 60)), 2.2);
                    
                    const beat = beats.find(b => exactTime >= b.start && exactTime < (b.start + b.duration));
                    const beatImpact = (beat ? Math.max(0, 1 - (exactTime - beat.start) / (beat.duration * 0.7)) : 0) * 1.2;

                    const interpPitches = s1.pitches.map((p, i) => (p * (1 - ease)) + ((s2.pitches?.[i] ?? p) * ease));
                    const interpTimbre = (s1.timbre || []).map((t, i) => (t * (1 - ease)) + ((s2.timbre?.[i] ?? t) * ease));

                    const bassEnergy = ((interpTimbre[0] || 0) + 100) / 200 + (interpTimbre[1] || 0) * 0.005 + beatImpact;
                    const trebleEnergy = ((interpTimbre[2] || 0) + (interpTimbre[3] || 0)) * 0.008;

                    for (let b = 0; b < 16; b++) {
                        let val = 0;
                        if (b < 4) {
                            // Graves: dominados por ritmo y frecuencias base
                            const pSum = (interpPitches[0] + interpPitches[1] + interpPitches[7]) / 3;
                            val = (bassEnergy * 0.75 + pSum * 0.25) * (1.2 - (b * 0.08));
                        } else if (b < 11) {
                            // Medios: armónicos vocales e instrumentos
                            const pIdx = (b - 4) * 2;
                            const pVal = (interpPitches[pIdx % 12] + interpPitches[(pIdx + 4) % 12]) / 2;
                            val = pVal * 0.85 + (avgNormalizedVolume * 0.3);
                        } else {
                            // Agudos: brillo tímbrico y sobretonos
                            const pIdx = (b - 11) * 3;
                            val = (interpPitches[pIdx % 12] * 0.35) + Math.max(0, trebleEnergy) * 0.65 + (avgNormalizedVolume * 0.2);
                        }
                        pseudoFreqBands[b] = Math.max(0, val * avgNormalizedVolume);
                    }
                }
            }

            const cBot = colorBotRef.current;
            const cTop = colorTopRef.current;
            const brightness = config.brightness || 150;

            const grad = ctx.createLinearGradient(0, canvas.height - mH, 0, canvas.height);
            const finalTopR = Math.min(255, cTop.r + brightness);
            const finalTopG = Math.min(255, cTop.g + brightness);
            const finalTopB = Math.min(255, cTop.b + brightness);
            
            grad.addColorStop(0, `rgb(${finalTopR}, ${finalTopG}, ${finalTopB})`);
            grad.addColorStop(1, `rgb(${cBot.r}, ${cBot.g}, ${cBot.b})`);

            // --- NEON SETTINGS ---
            if (config.neon) {
                const neonIntensity = 5 + (avgNormalizedVolume * 15);
                ctx.shadowBlur = neonIntensity;
                ctx.shadowColor = `rgba(${cBot.r}, ${cBot.g}, ${cBot.b}, 0.7)`; 
            } else {
                ctx.shadowBlur = 0;
            }

            const bW = (canvas.width / n);
            for (let i = 0; i < n; i++) {
                const pos = (i / (n - 1)) * 15;
                const iL = Math.floor(pos);
                const iR = Math.min(15, iL + 1);
                const p = pos - iL;
                const curve = (1 - Math.cos(p * Math.PI)) / 2;

                let tH = isPlaying ? ((pseudoFreqBands[iL] * (1 - curve)) + (pseudoFreqBands[iR] * curve)) * mH + 5 : 5;
                vels[i] = (vels[i] + (tH - heights[i]) * config.tension) * config.friction;
                heights[i] += vels[i];
                
                const finalH = Math.max(5, heights[i]);
                const y = canvas.height - finalH;
                const x = i * bW;

                ctx.fillStyle = grad;
                ctx.fillRect(x, y, Math.max(1, bW - 2), finalH); 
            }
            ctx.shadowBlur = 0; 
            
            animationId = requestAnimationFrame(renderLoop);
        };
        animationId = requestAnimationFrame(renderLoop);
        return () => { 
            cancelAnimationFrame(animationId); 
            Spicetify.Player.removeEventListener("songchange", onSongChange); 
        };
    }, [config]);

    // --- RENDER SETTINGS UI ---
    return React.createElement('div', { style: { width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, overflow: 'hidden' } },
        React.createElement('canvas', { ref: canvasRef, style: { display: 'block' } }),
        React.createElement('div', {
            className: 'viz-settings-panel',
            style: {
                position: 'absolute', top: '20px', right: '20px', padding: '15px', background: 'rgba(0,0,0,0.9)', borderRadius: '10px', color: 'white',
                display: 'flex', flexDirection: 'column', gap: '8px', opacity: '0.0', transition: 'opacity 0.3s', zIndex: 1000,
                width: '220px', boxShadow: '0 4px 15px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)', pointerEvents: 'auto'
            },
            onMouseEnter: (e) => e.currentTarget.style.opacity = '1',
            onMouseLeave: (e) => e.currentTarget.style.opacity = '0.0'
        },
            React.createElement('span', { style: { fontWeight: 'bold', fontSize: '14px', marginBottom: '5px', textAlign: 'center', color: '#1db954' } }, "VISUALIZER SETTINGS"),
            
            // --- COLOR SECTION ---
            React.createElement('div', { style: { borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', marginBottom: '5px' } },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' } },
                    React.createElement('label', { style: { fontSize: '11px', fontWeight: 'bold' } }, "Neon Effect"),
                    React.createElement('input', { type: 'checkbox', checked: config.neon, onChange: (e) => setConfig({...config, neon: e.target.checked}) })
                ),
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' } },
                    React.createElement('label', { style: { fontSize: '11px', fontWeight: 'bold' } }, "Manual Color Mode"),
                    React.createElement('input', { type: 'checkbox', checked: config.manual, onChange: (e) => setConfig({...config, manual: e.target.checked}) })
                ),
                config.manual && React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '8px' } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                        React.createElement('label', { style: { fontSize: '11px' } }, "Color (Bottom)"),
                        React.createElement('input', { type: 'color', value: config.hexBot, style: { width: '40px', height: '20px', border: 'none', padding: '0', background: 'none', cursor: 'pointer' }, onChange: (e) => setConfig({...config, hexBot: e.target.value}) })
                    ),
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                        React.createElement('label', { style: { fontSize: '11px' } }, "Color (Top)"),
                        React.createElement('input', { type: 'color', value: config.hexTop, style: { width: '40px', height: '20px', border: 'none', padding: '0', background: 'none', cursor: 'pointer' }, onChange: (e) => setConfig({...config, hexTop: e.target.value}) })
                    )
                )
            ),

            // --- SLIDERS SECTION ---
            ["Friction", "Tension", "Delay", "Sensitivity", "Bars", "Brightness Boost"].map((label, idx) => {
                const keys = ["friction", "tension", "delay", "sensitivity", "bars", "brightness"];
                const key = keys[idx];
                const value = config[key] || 0;
                
                let min = 0.5, max = 0.95, step = 0.01;
                if (key === "tension") { min = 0.02; max = 0.3; }
                else if (key === "delay") { min = -300; max = 300; step = 1; }
                else if (key === "sensitivity") { min = 0.5; max = 2.5; }
                else if (key === "bars") { min = 20; max = 150; step = 1; }
                else if (key === "brightness") { min = 0; max = 255; step = 5; }

                return React.createElement(React.Fragment, { key },
                    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' } },
                        React.createElement('label', null, label),
                        React.createElement('span', { style: { color: '#b3b3b3' } }, key === "delay" ? `${value}ms` : (key === "bars" || key === "brightness" ? value : value.toFixed(2)))
                    ),
                    React.createElement('input', { 
                        type: 'range', min, max, step, value, 
                        style: { width: '100%', cursor: 'pointer', accentColor: '#1db954' },
                        onChange: (e) => setConfig({...config, [key]: parseFloat(e.target.value)}) 
                    })
                );
            })
        )
    );
}

let render = () => React.createElement(VisualizadorProConfig);
