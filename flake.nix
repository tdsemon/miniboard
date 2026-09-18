{
  description = "Node.js development environment for the HTMX + Alpine Kanban Board";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      # Define supported systems for Linux and macOS
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forEachSystem = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forEachSystem (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            # Since HTMX and Alpine are imported via CDN and there is no build step,
            # Node.js is the only system-level dependency required to run the Express backend.
            packages = with pkgs; [
              nodejs_22 # This provides both `node` and `npm`
            ];

            shellHook = ''
              echo "====================================================="
              echo "🚀 HTMX + Alpine Kanban App Environment Loaded"
              echo "Node version: $(node -v)"
              echo "NPM version: $(npm -v)"
              echo "====================================================="
              echo ""
              echo "Initial setup commands from the tutorial:"
              echo "  1. npm init -y"
              echo "  2. npm install express ejs"
              echo "  3. npm install --save-dev nodemon"
              echo ""
            '';
          };
        }
      );
    };
}