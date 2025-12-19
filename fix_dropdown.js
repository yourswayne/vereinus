const fs = require("fs");
const path = "Vereinus/app/tasklist.tsx";
let t = fs.readFileSync(path, "utf8");
const dropdown = `function SimpleDropdown<T extends { id: string; name: string }>(
  {
    data,
    selectedId,
    onChange,
    placeholder = 'Liste wählen…',
    style,
    containerStyle,
  }: {
    data: T[];
    selectedId?: string;
    onChange: (id: string) => void;
    placeholder?: string;
    style?: any;
    containerStyle?: any;
  },
) {
  const [open, setOpen] = useState(false);
  const selected = data.find((d) => d.id === selectedId);

  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={[styles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, containerStyle]}
      >
        <Text numberOfLines={1} style={style}>{selected?.name ?? placeholder}</Text>
        <Text style={{ color: '#E5F4EF', fontSize: 18 }}>▼</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.dropdownOverlay} onPress={() => setOpen(false)} />

        <View style={styles.dropdownPanel}>
          <FlatList
            keyboardShouldPersistTaps="handled"
            data={data}
            keyExtractor={(x) => x.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => {
                  onChange(item.id);
                  setOpen(false);
                }}
                style={styles.dropdownItem}
              >
                <Text numberOfLines={1} style={styles.dropdownItemText}>{item.name}</Text>
              </TouchableOpacity>
            )}
            ListFooterComponent={(
              <TouchableOpacity
                onPress={() => {
                  onChange('__add__');
                  setOpen(false);
                }}
                style={styles.dropdownItem}
              >
                <Text numberOfLines={1} style={styles.dropdownItemText}>+ Liste hinzufügen...</Text>
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity onPress={() => setOpen(false)} style={styles.dropdownClose}>
            <Text style={styles.dropdownCloseText}>Schließen</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const PrioritySelector`;
const pattern = /function SimpleDropdown[\s\S]*?const PrioritySelector/;
if (!pattern.test(t)) {
  console.error('SimpleDropdown block not found');
  process.exit(1);
}
t = t.replace(pattern, dropdown);
fs.writeFileSync(path, t);
