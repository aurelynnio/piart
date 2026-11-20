using UnityEditor;
using UnityEngine;

namespace AIPixelStudio.Editor
{
    public class PixelStudioImporterWindow : EditorWindow
    {
        private string _sourcePackageDir = "";
        private string _targetAssetsFolder = "Assets/ImportedPixelStudio/Workshop";
        private string _lastSummary = "";

        [MenuItem("Tools/AI Pixel Studio/Import Package...")]
        public static void ShowWindow()
        {
            var win = GetWindow<PixelStudioImporterWindow>("AI Pixel Studio Importer");
            win.minSize = new Vector2(460, 260);
        }

        private void OnGUI()
        {
            GUILayout.Label("Nhập gói tài nguyên từ AI Pixel Studio", EditorStyles.boldLabel);
            EditorGUILayout.Space();

            EditorGUILayout.BeginHorizontal();
            _sourcePackageDir = EditorGUILayout.TextField("Thư mục gói xuất", _sourcePackageDir);
            if (GUILayout.Button("Chọn...", GUILayout.Width(72)))
            {
                var picked = EditorUtility.OpenFolderPanel("Chọn thư mục chứa manifest.json", _sourcePackageDir, "");
                if (!string.IsNullOrEmpty(picked)) _sourcePackageDir = picked;
            }
            EditorGUILayout.EndHorizontal();

            _targetAssetsFolder = EditorGUILayout.TextField("Thư mục đích (Assets/)", _targetAssetsFolder);
            EditorGUILayout.Space();

            if (GUILayout.Button("Nhập / Cập nhật gói vào Unity", GUILayout.Height(32)))
            {
                var report = PixelStudioImporter.ImportPackage(_sourcePackageDir, _targetAssetsFolder);
                if (report.Success)
                {
                    _lastSummary =
                        $"Thành công! Sprites: {report.ImportedSprites}, Clips: {report.ImportedClips}, Scenes: {report.ImportedScenes}\n" +
                        $"Added: {report.AddedCount}, Updated: {report.UpdatedCount}, Unchanged: {report.UnchangedCount}\n" +
                        $"Verification Scene: {report.VerificationScenePath}";
                    Debug.Log("[AI Pixel Studio Importer] " + _lastSummary);
                }
                else
                {
                    _lastSummary = "Lỗi nhập gói:\n- " + string.Join("\n- ", report.Errors);
                    Debug.LogError("[AI Pixel Studio Importer] " + _lastSummary);
                }
            }

            if (!string.IsNullOrEmpty(_lastSummary))
            {
                EditorGUILayout.Space();
                EditorGUILayout.HelpBox(_lastSummary, MessageType.Info);
            }
        }
    }
}
