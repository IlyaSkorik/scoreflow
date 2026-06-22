import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ScoreFlowApp());
}

class ScoreFlowApp extends StatelessWidget {
  const ScoreFlowApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ScoreFlow',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple, brightness: Brightness.dark),
        useMaterial3: true,
      ),
      home: const MainShellScreen(),
    );
  }
}

class MainShellScreen extends StatefulWidget {
  const MainShellScreen({super.key});

  @override
  State<MainShellScreen> createState() => _MainShellScreenState();
}

class _MainShellScreenState extends State<MainShellScreen> {
  InAppWebViewController? _webViewController;
  bool _isPlaying = false;
  double _currentTempo = 120.0;

  // Функция отправки команд в JavaScript через WebView
  void _sendPlaybackToJS(String action, double value) {
    if (_webViewController != null) {
      _webViewController?.evaluateJavascript(
        source: "handlePlaybackCommand('$action', $value);"
      );
    }
  }

  // Загрузка HTML как строки
  Future<void> _loadLocalHtml() async {
    if (_webViewController != null) {
      try {
        final String htmlContent = await rootBundle.loadString('assets/www/index.html');
        final String contentBase64 = base64Encode(const Utf8Encoder().convert(htmlContent));
        await _webViewController?.loadUrl(
          urlRequest: URLRequest(
            url: WebUri("data:text/html;base64,$contentBase64"),
          ),
        );
      } catch (e) {
        debugPrint("Ошибка загрузки HTML: $e");
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('ScoreFlow MVP'),
        actions: [
          IconButton(
            icon: const Icon(Icons.picture_as_pdf),
            onPressed: () {
              // Будущий экспорт в PDF
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Основная зона отображения нот (WebView)
          Expanded(
            child: InAppWebView(
              initialSettings: InAppWebViewSettings(
                allowFileAccessFromFileURLs: true,
                allowUniversalAccessFromFileURLs: true,
                useShouldOverrideUrlLoading: true,
                javaScriptEnabled: true,
              ),
              onWebViewCreated: (controller) {
                _webViewController = controller;
                _loadLocalHtml(); // Загружаем строку HTML сразу после создания
              },
              onConsoleMessage: (controller, consoleMessage) {
                debugPrint("JS Console: ${consoleMessage.message}");
              },
            ),
          ),
          
          // Панель управления темпом
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0),
            child: Row(
              children: [
                const Icon(Icons.speed, size: 20),
                Expanded(
                  child: Slider(
                    value: _currentTempo,
                    min: 60,
                    max: 240,
                    divisions: 180,
                    label: "${_currentTempo.round()} BPM",
                    onChanged: (value) {
                      setState(() {
                        _currentTempo = value;
                      });
                      if (_isPlaying) _sendPlaybackToJS('PLAY', _currentTempo);
                    },
                  ),
                ),
                Text("${_currentTempo.round()} BPM", style: const TextStyle(fontWeight: FontWeight.bold)),
              ],
            ),
          ),
        ],
      ),
      
      // Нижняя панель управления плеером
      bottomNavigationBar: BottomAppBar(
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            IconButton(
              icon: const Icon(Icons.skip_previous),
              onPressed: () {},
            ),
            FloatingActionButton(
              onPressed: () {
                setState(() {
                  _isPlaying = !_isPlaying;
                });
                _sendPlaybackToJS(_isPlaying ? 'PLAY' : 'PAUSE', _currentTempo);
              },
              child: Icon(_isPlaying ? Icons.pause : Icons.play_arrow),
            ),
            IconButton(
              icon: const Icon(Icons.skip_next),
              onPressed: () {},
            ),
          ],
        ),
      ),
    );
  }
}
